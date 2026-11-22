"""GET /invoices?document_id= and GET /invoices/{id}: read-only, for checking extraction."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.core.security import require_api_key
from app.db.models import Document, Invoice
from app.db.session import get_session
from app.schemas.invoices import InvoiceList, InvoiceOut

router = APIRouter(prefix="/invoices", tags=["invoices"], dependencies=[Depends(require_api_key)])
_LOAD = (selectinload(Invoice.line_items), selectinload(Invoice.issues))


@router.get("", response_model=InvoiceList)
def list_invoices(document_id: uuid.UUID = Query(...), session: Session = Depends(get_session)):
    if session.get(Document, document_id) is None:
        raise AppError(404, "Document not found.")
    rows = session.scalars(
        select(Invoice)
        .where(Invoice.document_id == document_id)
        .options(*_LOAD)
        .order_by(Invoice.created_at, Invoice.id)
    ).all()
    return InvoiceList(items=[InvoiceOut.model_validate(r) for r in rows], total=len(rows))


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: uuid.UUID, session: Session = Depends(get_session)):
    invoice = session.scalars(
        select(Invoice).where(Invoice.id == invoice_id).options(*_LOAD)
    ).first()
    if invoice is None:
        raise AppError(404, "Invoice not found.")
    return InvoiceOut.model_validate(invoice)
