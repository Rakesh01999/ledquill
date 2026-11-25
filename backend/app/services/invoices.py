"""Invoice use cases: list filters, manual correction with audit trail, approval."""

import json
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.core.logging import get_logger
from app.db.models import (
    Correction,
    Document,
    Invoice,
    LineItem,
    ProcessingEvent,
    ValidationIssue,
)
from app.pipeline.embed import Embedder, EmbeddingError
from app.pipeline.index import build_search_text
from app.pipeline.validate import normalize_supplier
from app.schemas.invoices import InvoiceCorrection
from app.workers.invoices import validate_invoice

log = get_logger(__name__)

LOAD = (
    selectinload(Invoice.line_items),
    selectinload(Invoice.issues),
    selectinload(Invoice.corrections),
)
_CENT, _FOURTH = Decimal("0.01"), Decimal("0.0001")
_SCALAR_FIELDS = (
    "invoice_number",
    "invoice_date",
    "supplier_name",
    "customer_name",
    "currency",
    "subtotal",
    "tax",
    "total",
)
_MONEY_FIELDS = {"subtotal", "tax", "total"}
_RELATED_CAP = 50  # other invoices re-validated after one correction


@dataclass(frozen=True)
class InvoiceFilters:
    supplier: str | None = None
    invoice_number: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    min_total: Decimal | None = None
    max_total: Decimal | None = None
    currency: str | None = None
    status: str | None = None
    q: str | None = None
    # supplier, currency and status also take several values (any of them matches).
    suppliers: tuple[str, ...] = ()
    # Exact supplier names (as listed by /invoices/facets): no substring, no typo tolerance.
    supplier_exact: tuple[str, ...] = ()
    currencies: tuple[str, ...] = ()
    statuses: tuple[str, ...] = ()


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def invoice_conditions(f: InvoiceFilters) -> list[ColumnElement[bool]]:
    """WHERE clauses for the keyword filters (FR-18). Every value is bound, never interpolated."""
    out: list[ColumnElement[bool]] = []
    names = tuple(dict.fromkeys(([f.supplier] if f.supplier else []) + list(f.suppliers)))
    if names:
        out.append(
            or_(
                *(
                    or_(
                        Invoice.supplier_name.ilike(f"%{escape_like(n)}%", escape="\\"),
                        Invoice.supplier_name.op("%")(n),  # pg_trgm: tolerant of typos
                    )
                    for n in names
                )
            )
        )
    if f.invoice_number:
        out.append(func.lower(Invoice.invoice_number) == f.invoice_number.lower())
    if f.date_from:
        out.append(Invoice.invoice_date >= f.date_from)
    if f.date_to:
        out.append(Invoice.invoice_date <= f.date_to)
    if f.min_total is not None:
        out.append(Invoice.total >= f.min_total)
    if f.max_total is not None:
        out.append(Invoice.total <= f.max_total)
    if f.supplier_exact:
        out.append(Invoice.supplier_name.in_(f.supplier_exact))
    codes = tuple(
        dict.fromkeys(c.upper() for c in ([f.currency] if f.currency else []) + list(f.currencies))
    )
    if codes:
        out.append(Invoice.currency.in_(codes))
    states = tuple(dict.fromkeys(([f.status] if f.status else []) + list(f.statuses)))
    if states:
        out.append(Invoice.status.in_(states))
    if f.q:
        out.append(Invoice.search_tsv.op("@@")(func.websearch_to_tsquery("english", f.q)))
    return out


def load_invoice(session: Session, invoice_id: uuid.UUID, *, lock: bool = False) -> Invoice:
    """The invoice with its relations freshly read; 404 when unknown."""
    stmt = (
        select(Invoice)
        .where(Invoice.id == invoice_id)
        .options(*LOAD)
        .execution_options(populate_existing=True)
    )
    if lock:
        stmt = stmt.with_for_update(of=Invoice)
    invoice = session.scalars(stmt).first()
    if invoice is None:
        raise AppError(404, "Invoice not found.")
    return invoice


def _refuse_if_archived(invoice: Invoice) -> None:
    if invoice.archived_at is not None:
        raise AppError(409, "This invoice is archived. Restore it first.")


# --- correction ---------------------------------------------------------------------------


def _text(value: object) -> str | None:
    """Canonical text of a field value, for the audit trail and for change detection."""
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    return str(value)


def _num(value: Decimal | None, step: Decimal) -> Decimal | None:
    return None if value is None else value.quantize(step)


def _item_rows(items: list) -> list[dict[str, str | None]]:
    def text(value: Decimal | None) -> str | None:
        return None if value is None else str(value)

    return [
        {
            "description": i.description or None,
            "quantity": text(_num(i.quantity, _FOURTH)),
            "unit_price": text(_num(i.unit_price, _FOURTH)),
            "amount": text(_num(i.amount, _CENT)),
        }
        for i in items
    ]


def _revalidate_related(session: Session, invoice: Invoice, old_number: str | None) -> None:
    """Re-run validation on the other invoices this correction can affect: those flagged against
    this one, and those sharing its old or new number (duplicate and cross-check rules)."""
    flagged = select(ValidationIssue.invoice_id).where(
        ValidationIssue.related_invoice_id == invoice.id
    )
    ids = set(session.scalars(flagged))
    numbers = {n for n in (old_number, invoice.invoice_number) if n}
    if numbers:
        ids |= set(session.scalars(select(Invoice.id).where(Invoice.invoice_number.in_(numbers))))
    ids.discard(invoice.id)
    others = select(Invoice).where(Invoice.id.in_(sorted(ids)[:_RELATED_CAP]))
    for other in session.scalars(others):
        validate_invoice(session, other, session.get(Document, other.document_id))


def _refresh_embedding(session: Session, invoice_id: uuid.UUID, embedder: Embedder | None) -> None:
    """Embed the corrected text in its own short transaction, after the correction committed, so
    a slow first model load never holds the invoice lock. A model failure is recorded in
    processing_events instead of passing silently; the invoice then has no vector (keyword search
    still finds it). If another correction changed the text meanwhile, that one owns the vector."""
    snapshot = session.get(Invoice, invoice_id).search_text
    vector, failure = None, None
    if embedder is not None and snapshot:
        try:
            (vector,) = embedder.embed_passages([snapshot])
        except EmbeddingError as exc:
            failure = str(exc)
    invoice = session.scalars(
        select(Invoice)
        .where(Invoice.id == invoice_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()
    if invoice is None or invoice.search_text != snapshot:
        session.rollback()
        return
    invoice.embedding = vector
    if failure:
        session.add(
            ProcessingEvent(
                document_id=invoice.document_id,
                stage="index",
                status="failed",
                detail={"trigger": "correction", "invoice_id": str(invoice.id), "error": failure},
            )
        )
    session.commit()


def correct_invoice(
    session: Session,
    invoice_id: uuid.UUID,
    body: InvoiceCorrection,
    embedder: Embedder | None = None,
) -> Invoice:
    """Apply the changed fields, log one `corrections` row per change, mark each corrected field
    confidence 1.0, then re-run V-01..V-09 and re-derive the status. An approved invoice that
    changes goes back to review. Nothing is written when no value actually changes."""
    invoice = load_invoice(session, invoice_id, lock=True)
    _refuse_if_archived(invoice)
    old_number = invoice.invoice_number
    changed: list[tuple[str, str | None, str | None]] = []

    for name in _SCALAR_FIELDS:
        if name not in body.model_fields_set:
            continue
        new = getattr(body, name)
        if name in _MONEY_FIELDS:
            new = _num(new, _CENT)
        old = getattr(invoice, name)
        if _text(new) != _text(old):
            changed.append((name, _text(old), _text(new)))
            setattr(invoice, name, new)

    if body.line_items is not None:
        new_rows, old_rows = _item_rows(body.line_items), _item_rows(invoice.line_items)
        if new_rows != old_rows:
            dump = {"ensure_ascii": False, "sort_keys": True}
            changed.append(
                ("line_items", json.dumps(old_rows, **dump), json.dumps(new_rows, **dump))
            )
            for old_item in list(invoice.line_items):
                session.delete(old_item)
            session.flush()
            session.add_all(
                LineItem(
                    invoice_id=invoice.id,
                    line_no=n,
                    description=item.description or None,
                    quantity=_num(item.quantity, _FOURTH),
                    unit_price=_num(item.unit_price, _FOURTH),
                    amount=_num(item.amount, _CENT),
                )
                for n, item in enumerate(body.line_items, 1)
            )
            session.flush()
            session.expire(invoice, ["line_items"])

    if not changed:
        return invoice

    session.add_all(
        Correction(invoice_id=invoice.id, field=f, old_value=o, new_value=n, note=body.note)
        for f, o, n in changed
    )
    invoice.confidence = {**(invoice.confidence or {}), **{f: 1.0 for f, _, _ in changed}}
    if any(f == "supplier_name" for f, _, _ in changed):
        invoice.supplier_norm = normalize_supplier(invoice.supplier_name)
    invoice.search_text = build_search_text(
        invoice_number=invoice.invoice_number,
        supplier_name=invoice.supplier_name,
        customer_name=invoice.customer_name,
        currency=invoice.currency,
        invoice_date=invoice.invoice_date,
        total=invoice.total,
        descriptions=[i.description for i in invoice.line_items],
    )
    invoice.status = "needs_review"  # revokes an approval; validate_invoice re-derives it
    validate_invoice(session, invoice, session.get(Document, invoice.document_id))
    _revalidate_related(session, invoice, old_number)
    invoice.embedding = None  # the old vector describes text that no longer exists
    session.commit()
    log.info("invoice_corrected", invoice_id=str(invoice.id), fields=[c[0] for c in changed])
    _refresh_embedding(session, invoice_id, embedder)
    return load_invoice(session, invoice_id)


# --- approval -----------------------------------------------------------------------------


def approve_invoice(session: Session, invoice_id: uuid.UUID) -> Invoice:
    """Approve unless an error-severity issue is open. Warnings do not block: overriding one is
    the reviewer's call. Approving an approved invoice is a no-op."""
    invoice = load_invoice(session, invoice_id, lock=True)
    _refuse_if_archived(invoice)
    if invoice.status == "approved":
        return invoice
    errors = sorted({i.rule_id for i in invoice.issues if i.severity == "error"})
    if errors:
        raise AppError(
            409,
            f"Cannot approve: fix the validation errors first ({', '.join(errors)}).",
            extra={"blocking_rules": errors},
        )
    invoice.status = "approved"
    session.commit()
    log.info("invoice_approved", invoice_id=str(invoice.id))
    return load_invoice(session, invoice_id)
