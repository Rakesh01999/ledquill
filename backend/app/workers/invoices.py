"""Database side of stages 3-5: write invoices, run validation, keep related rows consistent."""

from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import Session

from app.db.models import Document, Invoice, LineItem, ValidationIssue
from app.pipeline.fields import FieldsOutcome
from app.pipeline.index import build_search_text
from app.pipeline.split import Segment
from app.pipeline.validate import (
    Candidate,
    InvoiceData,
    Issue,
    LineData,
    cross_check_issues,
    derive_status,
    duplicate_issues,
    normalize_supplier,
    validate_fields,
)

_CENT, _FOURTH = Decimal("0.01"), Decimal("0.0001")
_MAX_MONEY, _MAX_QTY = Decimal(10) ** 12, Decimal(10) ** 10  # numeric(14,2) / numeric(14,4)
_CANDIDATE_LIMIT = 500


def _money(value: Decimal | None) -> Decimal | None:
    if value is None or abs(value) >= _MAX_MONEY:
        return None
    return value.quantize(_CENT, ROUND_HALF_UP)


def _quantity(value: Decimal | None) -> Decimal | None:
    if value is None or abs(value) >= _MAX_QTY:
        return None
    return value.quantize(_FOURTH, ROUND_HALF_UP)


def delete_document_invoices(session: Session, document_id: UUID) -> None:
    """Remove a document's invoices (idempotent re-run). Issues on other invoices that point
    at the removed ones are deleted too, and those invoices get their status re-derived."""
    ids = list(session.scalars(select(Invoice.id).where(Invoice.document_id == document_id)))
    if not ids:
        return
    affected = set(
        session.scalars(
            select(ValidationIssue.invoice_id).where(
                ValidationIssue.related_invoice_id.in_(ids),
                ValidationIssue.invoice_id.not_in(ids),
            )
        )
    )
    session.execute(delete(ValidationIssue).where(ValidationIssue.related_invoice_id.in_(ids)))
    session.execute(delete(Invoice).where(Invoice.id.in_(ids)))
    session.flush()
    for invoice_id in affected:
        if (other := session.get(Invoice, invoice_id)) is not None:
            recompute_status(session, other)


def recompute_status(session: Session, invoice: Invoice) -> None:
    if invoice.status == "approved":
        return
    issues = session.scalars(
        select(ValidationIssue).where(ValidationIssue.invoice_id == invoice.id)
    ).all()
    invoice.status = derive_status(issues)


def save_invoice(
    session: Session, document: Document, segment: Segment, outcome: FieldsOutcome
) -> Invoice:
    r = outcome.result
    invoice = Invoice(
        document_id=document.id,
        page_numbers=segment.page_numbers,
        invoice_number=r.invoice_number,
        invoice_date=r.invoice_date,
        supplier_name=r.supplier_name,
        customer_name=r.customer_name,
        currency=r.currency,
        subtotal=_money(r.subtotal),
        tax=_money(r.tax),
        total=_money(r.total),
        confidence=r.confidence_map(),
        raw_extraction=outcome.raw,
        method=outcome.method,
        model=outcome.model,
        status="needs_review",
        supplier_norm=normalize_supplier(r.supplier_name),
    )
    session.add(invoice)
    session.flush()
    for number, item in enumerate(r.line_items, 1):
        session.add(
            LineItem(
                invoice_id=invoice.id,
                line_no=number,
                description=item.description,
                quantity=_quantity(item.quantity),
                unit_price=_quantity(item.unit_price),
                amount=_money(item.amount),
            )
        )
    invoice.search_text = build_search_text(
        invoice_number=invoice.invoice_number,
        supplier_name=invoice.supplier_name,
        customer_name=invoice.customer_name,
        currency=invoice.currency,
        invoice_date=invoice.invoice_date,
        total=invoice.total,
        descriptions=[i.description for i in r.line_items],
    )
    session.flush()
    return invoice


def _to_data(invoice: Invoice) -> InvoiceData:
    return InvoiceData(
        invoice_number=invoice.invoice_number,
        invoice_date=invoice.invoice_date,
        supplier_name=invoice.supplier_name,
        currency=invoice.currency,
        subtotal=invoice.subtotal,
        tax=invoice.tax,
        total=invoice.total,
        line_items=[
            LineData(i.description, i.quantity, i.unit_price, i.amount) for i in invoice.line_items
        ],
        confidence=dict(invoice.confidence or {}),
    )


def _candidates(session: Session, invoice: Invoice, document: Document) -> list[Candidate]:
    conditions = [and_(Document.sha256 == document.sha256, Document.id != document.id)]
    if invoice.invoice_number:
        conditions.append(Invoice.invoice_number == invoice.invoice_number)
    rows = session.execute(
        select(Invoice, Document)
        .join(Document, Invoice.document_id == Document.id)
        .where(Invoice.id != invoice.id, Invoice.archived_at.is_(None), or_(*conditions))
        .limit(_CANDIDATE_LIMIT)
    ).all()
    return [
        Candidate(
            invoice_id=i.id,
            document_id=d.id,
            filename=d.filename,
            sha256=d.sha256,
            invoice_number=i.invoice_number,
            invoice_date=i.invoice_date,
            supplier_norm=i.supplier_norm,
            total=i.total,
        )
        for i, d in rows
    ]


def validate_invoice(session: Session, invoice: Invoice, document: Document) -> list[Issue]:
    """Run V-01..V-09, replace the invoice's issues and derive its status. Never raises for
    bad data: it only records issues."""
    data = _to_data(invoice)
    raw = invoice.raw_extraction or {}
    issues = validate_fields(
        data,
        llm_unavailable=raw.get("llm_status") in ("unavailable", "error"),
        injection_lines=int(raw.get("injection_lines_removed") or 0),
        poor_scan=raw.get("llm_status") == "poor_scan",
    )
    candidates = _candidates(session, invoice, document)
    issues += duplicate_issues(
        data, document_id=document.id, sha256=document.sha256, candidates=candidates
    )
    issues += cross_check_issues(data, document_id=document.id, candidates=candidates)

    session.execute(delete(ValidationIssue).where(ValidationIssue.invoice_id == invoice.id))
    session.add_all(
        ValidationIssue(
            invoice_id=invoice.id,
            rule_id=i.rule_id,
            severity=i.severity,
            field=i.field,
            expected=i.expected,
            actual=i.actual,
            message=i.message,
            related_invoice_id=i.related_invoice_id,
        )
        for i in issues
    )
    if invoice.status != "approved":
        invoice.status = derive_status(issues)
    session.flush()
    return issues
