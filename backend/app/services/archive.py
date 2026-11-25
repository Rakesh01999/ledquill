"""Archive and restore: hide documents and invoices without ever deleting them.

A document archive stamps one timestamp on the document and on every invoice that was not
already archived; a restore brings back exactly the invoices carrying that stamp, so an invoice
archived on its own earlier stays archived. Archived invoices take no part in the duplicate
rules (V-07, V-09), so archiving or restoring re-validates the invoices they can affect.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.logging import get_logger
from app.db.models import Document, Invoice, ValidationIssue
from app.services.documents import _active, _lock_document
from app.workers.invoices import validate_invoice

log = get_logger(__name__)
_NEIGHBOUR_CAP = 50  # other invoices re-validated after one archive or restore


def _refuse_if_active(doc: Document, action: str) -> None:
    """Strict: no stale override, a worker may still be writing invoices under the document."""
    if _active(doc):
        raise AppError(409, f"Cannot {action}: the document is still {doc.status}.")


def _revalidate(session: Session, changed: list[Invoice], *, restored: bool) -> None:
    """Re-run V-01..V-09 where an archive or restore matters, with the duplicate rules limited to
    earlier uploads (what the pipeline saw first), so archive then restore returns every invoice
    to its previous issues and status.

    Archive: the invoices that were flagged against the archived ones lose those flags.
    Restore: the restored invoices are checked again, and so are the later invoices that share
    their invoice number or file, which gain the flag back."""
    if not changed:
        return
    ids = {i.id for i in changed}
    flagged = set(
        session.scalars(
            select(ValidationIssue.invoice_id).where(ValidationIssue.related_invoice_id.in_(ids))
        )
    )
    later: set = set()
    if restored:
        numbers = {i.invoice_number for i in changed if i.invoice_number}
        docs = [i.document_id for i in changed]
        hashes = set(session.scalars(select(Document.sha256).where(Document.id.in_(docs))))
        first = session.scalar(select(func.min(Document.created_at)).where(Document.id.in_(docs)))
        later = set(
            session.scalars(
                select(Invoice.id)
                .join(Document, Invoice.document_id == Document.id)
                .where(
                    or_(Invoice.invoice_number.in_(numbers), Document.sha256.in_(hashes)),
                    Document.created_at >= first,
                )
            )
        )
    others = sorted((flagged | later) - ids)[:_NEIGHBOUR_CAP]
    live = select(Invoice).where(Invoice.id.in_(others), Invoice.archived_at.is_(None))
    rows = list(session.scalars(live))
    if restored:
        rows += changed
    for invoice in rows:
        document = session.get(Document, invoice.document_id)
        validate_invoice(session, invoice, document, earlier_only=True)


def archive_document(session: Session, document_id: uuid.UUID) -> Document:
    doc = _lock_document(session, document_id)
    _refuse_if_active(doc, "archive")
    if doc.archived_at is not None:
        return doc
    stamp = datetime.now(UTC)
    doc.archived_at = stamp
    live = list(
        session.scalars(
            select(Invoice).where(Invoice.document_id == doc.id, Invoice.archived_at.is_(None))
        )
    )
    for invoice in live:
        invoice.archived_at = stamp
    session.flush()
    _revalidate(session, live, restored=False)
    session.commit()
    log.info("document_archived", document_id=str(doc.id), invoices=len(live))
    return doc


def restore_document(session: Session, document_id: uuid.UUID) -> Document:
    doc = _lock_document(session, document_id)
    _refuse_if_active(doc, "restore")
    stamp = doc.archived_at
    if stamp is None:
        return doc
    doc.archived_at = None
    back = list(
        session.scalars(
            select(Invoice).where(Invoice.document_id == doc.id, Invoice.archived_at == stamp)
        )
    )
    for invoice in back:
        invoice.archived_at = None
    session.flush()
    _revalidate(session, back, restored=True)
    session.commit()
    log.info("document_restored", document_id=str(doc.id), invoices=len(back))
    return doc


def _lock_invoice(session: Session, invoice_id: uuid.UUID) -> tuple[Invoice, Document]:
    """The invoice and its document, both locked (document first, like archive and reprocess)."""
    document_id = session.scalar(select(Invoice.document_id).where(Invoice.id == invoice_id))
    if document_id is None:
        raise AppError(404, "Invoice not found.")
    doc = _lock_document(session, document_id)
    invoice = session.scalars(
        select(Invoice)
        .where(Invoice.id == invoice_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()
    if invoice is None:
        raise AppError(404, "Invoice not found.")
    return invoice, doc


def archive_invoice(session: Session, invoice_id: uuid.UUID) -> Invoice:
    invoice, doc = _lock_invoice(session, invoice_id)
    _refuse_if_active(doc, "archive")
    if invoice.archived_at is not None:
        return invoice
    invoice.archived_at = datetime.now(UTC)
    session.flush()
    _revalidate(session, [invoice], restored=False)
    session.commit()
    log.info("invoice_archived", invoice_id=str(invoice.id))
    return invoice


def restore_invoice(session: Session, invoice_id: uuid.UUID) -> Invoice:
    invoice, doc = _lock_invoice(session, invoice_id)
    _refuse_if_active(doc, "restore")
    if invoice.archived_at is None:
        return invoice
    if doc.archived_at is not None:
        raise AppError(409, "Cannot restore: its document is archived. Restore the document first.")
    invoice.archived_at = None
    session.flush()
    _revalidate(session, [invoice], restored=True)
    session.commit()
    log.info("invoice_restored", invoice_id=str(invoice.id))
    return invoice
