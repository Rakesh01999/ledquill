"""Global search: one box over documents, invoices, suppliers and archived items.

Plain SQL, no embeddings: ILIKE substring matches (backed by trigram indexes on the file name,
invoice number and supplier name), id prefixes and amounts. Every user value is bound, and the
LIKE wildcards in it are escaped, so `%`, `_` and quotes only ever mean themselves. Each group is
cut in the database (limit + 1 rows, so `more` is known without counting everything).
"""

import re
from decimal import Decimal, InvalidOperation

from sqlalchemy import ColumnElement, Text, case, cast, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import Document, Invoice
from app.schemas.search import (
    ArchivedHit,
    DocumentHit,
    GlobalGroup,
    GlobalSearch,
    InvoiceHit,
    SupplierHit,
)
from app.services.invoices import escape_like

_ID_PREFIX = re.compile(r"^[0-9a-f-]{4,36}$", re.IGNORECASE)
_AMOUNT = re.compile(r"^\d+(\.\d{1,4})?$")
_MIN_AMOUNT_CHARS = 3  # "5" would match every total starting with 5


def normalize_amount(q: str) -> str | None:
    """ "2,970.00", "$ 2970", "2 970.5" -> "2970.00", "2970", "2970.5"; None when not a number."""
    cleaned = re.sub(r"[\s,\u00a0$€£]", "", q)
    if len(cleaned) < _MIN_AMOUNT_CHARS or not _AMOUNT.match(cleaned):
        return None
    try:
        Decimal(cleaned)
    except InvalidOperation:  # pragma: no cover - the pattern already ensures a number
        return None
    return cleaned


def _like(value: str, *, prefix: bool = False) -> str:
    return f"{escape_like(value)}%" if prefix else f"%{escape_like(value)}%"


def _invoice_match(q: str) -> list[ColumnElement[bool]]:
    """Conditions of which any one makes an invoice match."""
    ors: list[ColumnElement[bool]] = [
        Invoice.invoice_number.ilike(_like(q), escape="\\"),
        Invoice.supplier_name.ilike(_like(q), escape="\\"),
    ]
    if _ID_PREFIX.match(q):
        ors.append(cast(Invoice.id, Text).ilike(_like(q, prefix=True), escape="\\"))
    if re.fullmatch(r"[A-Za-z]{3}", q):
        ors.append(Invoice.currency == q.upper())
    amount = normalize_amount(q)
    if amount is not None:
        # Text prefix of the stored value: "2970" finds 2970.00 and 2970.50, "2970.00" only one.
        ors.append(cast(Invoice.total, Text).like(_like(amount, prefix=True), escape="\\"))
    return ors


def _document_match(q: str) -> list[ColumnElement[bool]]:
    ors: list[ColumnElement[bool]] = [Document.filename.ilike(_like(q), escape="\\")]
    if _ID_PREFIX.match(q):
        ors.append(cast(Document.id, Text).ilike(_like(q, prefix=True), escape="\\"))
    return ors


def _amount_text(inv: Invoice) -> str | None:
    if inv.total is None:
        return None
    return f"{inv.currency} {inv.total:,.2f}" if inv.currency else f"{inv.total:,.2f}"


def global_search(session: Session, q: str, limit: int) -> GlobalSearch:
    q = " ".join(q.split())
    cap = limit + 1

    # Rank: an exact invoice number first, then numbers that start with the query, then the rest.
    exact = func.lower(Invoice.invoice_number) == q.lower()
    starts = Invoice.invoice_number.ilike(_like(q, prefix=True), escape="\\")
    rank = case((exact, 0), (starts, 1), else_=2)
    invoice_order = (
        rank,
        Invoice.invoice_date.desc().nulls_last(),
        Invoice.created_at.desc(),
        Invoice.id,
    )

    live_documents = session.scalars(
        select(Document)
        .where(Document.archived_at.is_(None), or_(*_document_match(q)))
        .order_by(Document.created_at.desc(), Document.id)
        .limit(cap)
    ).all()
    live_invoices = session.scalars(
        select(Invoice)
        .where(Invoice.archived_at.is_(None), or_(*_invoice_match(q)))
        .order_by(*invoice_order)
        .limit(cap)
    ).all()
    count = func.count()
    suppliers = session.execute(
        select(Invoice.supplier_name, count)
        .where(
            Invoice.archived_at.is_(None),
            Invoice.supplier_name.is_not(None),
            Invoice.supplier_name.ilike(_like(q), escape="\\"),
        )
        .group_by(Invoice.supplier_name)
        .order_by(count.desc(), Invoice.supplier_name)
        .limit(cap)
    ).all()

    archived_documents = session.scalars(
        select(Document)
        .where(Document.archived_at.is_not(None), or_(*_document_match(q)))
        .order_by(Document.archived_at.desc(), Document.id)
        .limit(cap)
    ).all()
    archived_invoices = session.scalars(
        select(Invoice)
        .where(Invoice.archived_at.is_not(None), or_(*_invoice_match(q)))
        .order_by(Invoice.archived_at.desc(), Invoice.id)
        .limit(cap)
    ).all()
    archived = sorted(
        [
            ArchivedHit(
                kind="document",
                id=d.id,
                document_id=d.id,
                title=d.filename,
                detail=d.file_type.upper(),
                archived_at=d.archived_at,
            )
            for d in archived_documents
        ]
        + [
            ArchivedHit(
                kind="invoice",
                id=i.id,
                document_id=i.document_id,
                title=i.invoice_number or "No invoice number",
                detail=" · ".join(p for p in (i.supplier_name, _amount_text(i)) if p) or None,
                archived_at=i.archived_at,
            )
            for i in archived_invoices
        ],
        key=lambda hit: hit.archived_at,
        reverse=True,
    )

    return GlobalSearch(
        q=q,
        documents=GlobalGroup[DocumentHit](
            items=[
                DocumentHit(
                    id=d.id,
                    filename=d.filename,
                    file_type=d.file_type,
                    status=d.status,
                    created_at=d.created_at,
                )
                for d in live_documents[:limit]
            ],
            more=len(live_documents) > limit,
        ),
        invoices=GlobalGroup[InvoiceHit](
            items=[
                InvoiceHit(
                    id=i.id,
                    document_id=i.document_id,
                    invoice_number=i.invoice_number,
                    supplier_name=i.supplier_name,
                    total=i.total,
                    currency=i.currency,
                    invoice_date=i.invoice_date,
                    status=i.status,
                )
                for i in live_invoices[:limit]
            ],
            more=len(live_invoices) > limit,
        ),
        suppliers=GlobalGroup[SupplierHit](
            items=[SupplierHit(supplier=name, count=n) for name, n in suppliers[:limit]],
            more=len(suppliers) > limit,
        ),
        archived=GlobalGroup[ArchivedHit](
            items=archived[:limit],
            more=len(archived) > limit
            or len(archived_documents) > limit
            or len(archived_invoices) > limit,
        ),
    )
