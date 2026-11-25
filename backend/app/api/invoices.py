"""Invoices: filtered list, detail, manual correction and approval."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import case, exists, func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.pagination import PageParams, page_params
from app.core.security import require_api_key
from app.db.models import Document, Invoice, ValidationIssue
from app.db.session import get_session
from app.pipeline.embed import Embedder, get_embedder
from app.schemas.invoices import (
    FacetValue,
    InvoiceCorrection,
    InvoiceFacets,
    InvoiceList,
    InvoiceOut,
)
from app.services.archive import archive_invoice, restore_invoice
from app.services.invoices import (
    LOAD,
    InvoiceFilters,
    approve_invoice,
    correct_invoice,
    escape_like,
    invoice_conditions,
    load_invoice,
)

router = APIRouter(prefix="/invoices", tags=["invoices"], dependencies=[Depends(require_api_key)])


def invoice_filters(
    supplier: list[Annotated[str, Field(min_length=1, max_length=200)]] | None = Query(None),
    supplier_exact: list[Annotated[str, Field(min_length=1, max_length=200)]] | None = Query(
        None, description="Exact supplier names, as listed by /invoices/facets. Any one matches."
    ),
    invoice_number: str | None = Query(None, min_length=1, max_length=100),
    date_from: date | None = None,
    date_to: date | None = None,
    min_total: Decimal | None = Query(None, max_digits=14, decimal_places=2),
    max_total: Decimal | None = Query(None, max_digits=14, decimal_places=2),
    currency: list[Annotated[str, Field(pattern=r"^[A-Za-z]{3}$")]] | None = Query(None),
    status: list[Literal["needs_review", "ready", "approved"]] | None = Query(None),
    q: str | None = Query(None, min_length=1, max_length=200),
) -> InvoiceFilters:
    if date_from and date_to and date_from > date_to:
        raise AppError(422, "date_from must not be after date_to.")
    if min_total is not None and max_total is not None and min_total > max_total:
        raise AppError(422, "min_total must not be greater than max_total.")
    # supplier, currency and status may repeat (`?supplier=A&supplier=B`): any value matches.
    return InvoiceFilters(
        invoice_number=invoice_number,
        date_from=date_from,
        date_to=date_to,
        min_total=min_total,
        max_total=max_total,
        q=q,
        suppliers=tuple(supplier or ()),
        supplier_exact=tuple(supplier_exact or ()),
        currencies=tuple(currency or ()),
        statuses=tuple(status or ()),
    )


def _severity_rank():
    def has(*conditions):
        return exists().where(ValidationIssue.invoice_id == Invoice.id, *conditions)

    return case(
        (has(ValidationIssue.severity == "error"), 0),
        (has(ValidationIssue.severity == "warning", ValidationIssue.rule_id != "V-08"), 1),
        (has(ValidationIssue.rule_id == "V-08"), 2),
        else_=3,
    )


SortKey = Literal["newest", "severity", "number", "supplier", "date", "total", "status", "issues"]
_COLUMN_SORTS = ("number", "supplier", "date", "total", "status", "issues")


def _sort_expression(sort: str):
    """The expression a column sort orders by. Text sorts ignore case."""
    return {
        "number": func.lower(Invoice.invoice_number),
        "supplier": func.lower(Invoice.supplier_name),
        "date": Invoice.invoice_date,
        "total": Invoice.total,
        "status": Invoice.status,
        "issues": select(func.count())
        .where(ValidationIssue.invoice_id == Invoice.id)
        .correlate(Invoice)
        .scalar_subquery(),
    }[sort]


@router.get("/facets", response_model=InvoiceFacets)
def invoice_facets(
    archived: bool = False,
    q: str | None = Query(None, min_length=1, max_length=100, description="Narrow the suppliers."),
    limit: int = Query(200, ge=1, le=500),
    session: Session = Depends(get_session),
):
    """Distinct suppliers (most invoices first, then A-Z) and currencies, for filter dropdowns.
    `q` narrows the suppliers by a case-insensitive substring; `limit` caps the suppliers."""
    live = Invoice.archived_at.is_not(None) if archived else Invoice.archived_at.is_(None)

    def distinct(column, *extra, cap: int):
        count = func.count()
        rows = session.execute(
            select(column, count)
            .where(live, column.is_not(None), column != "", *extra)
            .group_by(column)
            .order_by(count.desc(), column)
            .limit(cap)
        ).all()
        return [FacetValue(value=v, count=n) for v, n in rows]

    narrow = [Invoice.supplier_name.ilike(f"%{escape_like(q)}%", escape="\\")] if q else []
    return InvoiceFacets(
        suppliers=distinct(Invoice.supplier_name, *narrow, cap=limit),
        currencies=distinct(Invoice.currency, cap=100),
    )


@router.get("", response_model=InvoiceList)
def list_invoices(
    document_id: uuid.UUID | None = None,
    sort: SortKey = "newest",
    order: Literal["asc", "desc"] | None = Query(
        None, description="Direction of a column sort; each column has a default."
    ),
    archived: bool = False,
    filters: InvoiceFilters = Depends(invoice_filters),
    page: PageParams = Depends(page_params),
    session: Session = Depends(get_session),
):
    """Newest first; the invoices of one document come in document order. `sort=severity` is the
    review-queue order: open errors, then other warnings, then low-confidence only (V-08), then
    invoices with no issue; oldest first within each group. Archived invoices are left out unless
    `archived=true`, which lists only them."""
    where = invoice_conditions(filters)
    where.append(Invoice.archived_at.is_not(None) if archived else Invoice.archived_at.is_(None))
    order_by = (Invoice.created_at.desc(), Invoice.id)
    if sort == "severity":
        order_by = (_severity_rank(), Invoice.created_at, Invoice.id)
    elif sort in _COLUMN_SORTS:
        # Text and dates read best ascending, amounts and issue counts descending; empty last.
        descending = (order or ("desc" if sort in ("total", "issues") else "asc")) == "desc"
        column = _sort_expression(sort)
        order_by = (
            (column.desc() if descending else column.asc()).nulls_last(),
            Invoice.created_at.desc(),
            Invoice.id,
        )
    if document_id is not None:
        if session.get(Document, document_id) is None:
            raise AppError(404, "Document not found.")
        where.append(Invoice.document_id == document_id)
        order_by = (Invoice.created_at, Invoice.id)
    total = session.scalar(select(func.count()).select_from(Invoice).where(*where)) or 0
    rows = session.scalars(
        select(Invoice)
        .where(*where)
        .options(*LOAD)
        .order_by(*order_by)
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return InvoiceList(
        items=[InvoiceOut.model_validate(r) for r in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: uuid.UUID, session: Session = Depends(get_session)):
    return InvoiceOut.model_validate(load_invoice(session, invoice_id))


@router.patch("/{invoice_id}", response_model=InvoiceOut)
def patch_invoice(
    invoice_id: uuid.UUID,
    body: InvoiceCorrection,
    session: Session = Depends(get_session),
    embedder: Embedder | None = Depends(get_embedder),
):
    return InvoiceOut.model_validate(correct_invoice(session, invoice_id, body, embedder))


@router.post("/{invoice_id}/approve", response_model=InvoiceOut)
def approve(invoice_id: uuid.UUID, session: Session = Depends(get_session)):
    return InvoiceOut.model_validate(approve_invoice(session, invoice_id))


@router.post("/{invoice_id}/archive", response_model=InvoiceOut)
def archive(invoice_id: uuid.UUID, session: Session = Depends(get_session)):
    """Hide the invoice. Nothing is deleted. 409 while its document is queued or processing."""
    archive_invoice(session, invoice_id)
    return InvoiceOut.model_validate(load_invoice(session, invoice_id))


@router.post("/{invoice_id}/restore", response_model=InvoiceOut)
def restore(invoice_id: uuid.UUID, session: Session = Depends(get_session)):
    """Bring the invoice back. 409 while its document is archived (restore the document)."""
    restore_invoice(session, invoice_id)
    return InvoiceOut.model_validate(load_invoice(session, invoice_id))
