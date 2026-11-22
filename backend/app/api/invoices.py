"""Invoices: filtered list, detail, manual correction and approval."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, exists, func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.pagination import PageParams, page_params
from app.core.security import require_api_key
from app.db.models import Document, Invoice, ValidationIssue
from app.db.session import get_session
from app.pipeline.embed import Embedder, get_embedder
from app.schemas.invoices import InvoiceCorrection, InvoiceList, InvoiceOut
from app.services.invoices import (
    LOAD,
    InvoiceFilters,
    approve_invoice,
    correct_invoice,
    invoice_conditions,
    load_invoice,
)

router = APIRouter(prefix="/invoices", tags=["invoices"], dependencies=[Depends(require_api_key)])


def invoice_filters(
    supplier: str | None = Query(None, min_length=1, max_length=200),
    invoice_number: str | None = Query(None, min_length=1, max_length=100),
    date_from: date | None = None,
    date_to: date | None = None,
    min_total: Decimal | None = Query(None, max_digits=14, decimal_places=2),
    max_total: Decimal | None = Query(None, max_digits=14, decimal_places=2),
    currency: str | None = Query(None, pattern=r"^[A-Za-z]{3}$"),
    status: Literal["needs_review", "ready", "approved"] | None = None,
    q: str | None = Query(None, min_length=1, max_length=200),
) -> InvoiceFilters:
    if date_from and date_to and date_from > date_to:
        raise AppError(422, "date_from must not be after date_to.")
    if min_total is not None and max_total is not None and min_total > max_total:
        raise AppError(422, "min_total must not be greater than max_total.")
    return InvoiceFilters(
        supplier, invoice_number, date_from, date_to, min_total, max_total, currency, status, q
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


@router.get("", response_model=InvoiceList)
def list_invoices(
    document_id: uuid.UUID | None = None,
    sort: Literal["newest", "severity"] = "newest",
    filters: InvoiceFilters = Depends(invoice_filters),
    page: PageParams = Depends(page_params),
    session: Session = Depends(get_session),
):
    """Newest first; the invoices of one document come in document order. `sort=severity` is the
    review-queue order: open errors, then other warnings, then low-confidence only (V-08), then
    invoices with no issue; oldest first within each group."""
    where = invoice_conditions(filters)
    order = (Invoice.created_at.desc(), Invoice.id)
    if sort == "severity":
        order = (_severity_rank(), Invoice.created_at, Invoice.id)
    if document_id is not None:
        if session.get(Document, document_id) is None:
            raise AppError(404, "Document not found.")
        where.append(Invoice.document_id == document_id)
        order = (Invoice.created_at, Invoice.id)
    total = session.scalar(select(func.count()).select_from(Invoice).where(*where)) or 0
    rows = session.scalars(
        select(Invoice)
        .where(*where)
        .options(*LOAD)
        .order_by(*order)
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
