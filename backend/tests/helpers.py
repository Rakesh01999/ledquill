"""Test helpers shared by unit, API and integration tests."""

import hashlib
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import Document, Invoice, Job, LineItem
from app.pipeline.detect import HEAD_BYTES, detect
from app.pipeline.index import build_search_text
from app.pipeline.validate import normalize_supplier
from app.storage import get_storage
from app.workers.invoices import validate_invoice
from tests.fakes import StubEmbedder


def create_document(
    session: Session, source: Path, name: str | None = None
) -> tuple[Document, Job]:
    """Store `source` through the real storage backend and insert queued document + job rows."""
    data = source.read_bytes()
    doc_id = uuid.uuid4()
    key = f"documents/{doc_id}/{name or source.name}"
    get_storage().save(key, iter([data]))
    detected = detect(data[:HEAD_BYTES]) if data else None
    document = Document(
        id=doc_id,
        filename=name or source.name,
        file_type=detected.file_type if detected else "pdf",
        mime_type=detected.mime_type if detected else "application/pdf",
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        storage_key=key,
        status="queued",
        progress=0,
    )
    job = Job(id=uuid.uuid4(), document_id=doc_id, kind="process", status="queued", attempts=0)
    session.add(document)
    session.flush()
    session.add(job)
    session.commit()
    return document, job


FIELD_CONFIDENCE = {
    name: 0.95
    for name in (
        "invoice_number",
        "invoice_date",
        "supplier_name",
        "customer_name",
        "currency",
        "subtotal",
        "tax",
        "total",
    )
}


def seed_invoice(
    session: Session,
    *,
    document: Document | None = None,
    document_status: str = "completed",
    file_type: str = "pdf",
    supplier: str | None = "Acme Supplies Ltd",
    number: str | None = "INV-1",
    invoice_date: date | None = date(2026, 9, 1),
    currency: str | None = "USD",
    subtotal: str | None = "1000.00",
    tax: str | None = "150.00",
    total: str | None = "1150.00",
    items: tuple[tuple[str, str], ...] = (("A4 paper", "1000.00"),),
    confidence: dict[str, float] | None = None,
    embedded: bool = True,
) -> Invoice:
    """Insert a document (unless given), one invoice with line items, and run validation, so the
    status and issues are what the real pipeline would produce. No file is stored."""
    if document is None:
        doc_id = uuid.uuid4()
        document = Document(
            id=doc_id,
            filename=f"{doc_id}.pdf",
            file_type=file_type,
            mime_type="application/pdf",
            sha256=uuid.uuid4().hex + uuid.uuid4().hex,
            size_bytes=1,
            storage_key=f"documents/{doc_id}/seed.pdf",
            status=document_status,
            progress=100 if document_status == "completed" else 0,
        )
        session.add(document)
        session.flush()
        now = datetime.now(UTC)
        session.add(
            Job(
                id=uuid.uuid4(),
                document_id=doc_id,
                kind="process",
                status=document_status,
                attempts=1,
                started_at=now - timedelta(seconds=4),
                finished_at=now,
            )
        )

    def dec(value: str | None) -> Decimal | None:
        return None if value is None else Decimal(value)

    invoice = Invoice(
        document_id=document.id,
        page_numbers=[1],
        invoice_number=number,
        invoice_date=invoice_date,
        supplier_name=supplier,
        customer_name="Globex Corp",
        currency=currency,
        subtotal=dec(subtotal),
        tax=dec(tax),
        total=dec(total),
        confidence=FIELD_CONFIDENCE if confidence is None else confidence,
        method="llm",
        model="groq:test",
        status="needs_review",
        supplier_norm=normalize_supplier(supplier),
    )
    session.add(invoice)
    session.flush()
    for n, (description, amount) in enumerate(items, 1):
        session.add(
            LineItem(
                invoice_id=invoice.id,
                line_no=n,
                description=description,
                quantity=Decimal("1.0000"),
                unit_price=Decimal(amount),
                amount=Decimal(amount),
            )
        )
    session.flush()
    invoice.search_text = build_search_text(
        invoice_number=number,
        supplier_name=supplier,
        customer_name="Globex Corp",
        currency=currency,
        invoice_date=invoice_date,
        total=dec(total),
        descriptions=[d for d, _ in items],
    )
    if embedded and invoice.search_text:
        (invoice.embedding,) = StubEmbedder().embed_passages([invoice.search_text])
    session.flush()
    validate_invoice(session, invoice, document)
    session.commit()
    return invoice
