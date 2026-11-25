"""Document use cases: reprocess, and the latest-job lookup behind the status views."""

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from kombu.exceptions import KombuError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, TransientError
from app.core.logging import get_logger
from app.core.settings import Settings
from app.db.models import Correction, Document, Invoice, Job, ValidationIssue
from app.schemas.documents import DocumentOut
from app.storage import Storage
from app.workers.invoices import delete_document_invoices
from app.workers.tasks import process_document

log = get_logger(__name__)


def latest_jobs(session: Session, document_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Job]:
    """The newest job of each document. A queued job (never started, not finished) counts
    as newest; a job that never started but failed is ordered by when it finished."""
    jobs: dict[uuid.UUID, Job] = {}
    rows = session.scalars(
        select(Job)
        .where(Job.document_id.in_(list(document_ids)))
        .order_by(func.coalesce(Job.started_at, Job.finished_at).desc().nullsfirst())
    )
    for job in rows:
        jobs.setdefault(job.document_id, job)
    return jobs


def document_counts(
    session: Session, document_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    """(invoice_count, issue_count) per document; documents without invoices are absent."""
    ids = list(document_ids)
    # An active document counts its live invoices; an archived one counts all of them.
    shown = Invoice.archived_at.is_(None) | Document.archived_at.is_not(None)
    invoices = {
        doc_id: n
        for doc_id, n in session.execute(
            select(Invoice.document_id, func.count())
            .join(Document, Document.id == Invoice.document_id)
            .where(Invoice.document_id.in_(ids), shown)
            .group_by(Invoice.document_id)
        )
    }
    issues = {
        doc_id: n
        for doc_id, n in session.execute(
            select(Invoice.document_id, func.count(ValidationIssue.id))
            .join(ValidationIssue, ValidationIssue.invoice_id == Invoice.id)
            .join(Document, Document.id == Invoice.document_id)
            .where(Invoice.document_id.in_(ids), shown)
            .group_by(Invoice.document_id)
        )
    }
    return {i: (invoices.get(i, 0), issues.get(i, 0)) for i in ids}


def document_out(doc: Document, job: Job | None, counts: tuple[int, int] = (0, 0)) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        filename=doc.filename,
        file_type=doc.file_type,
        mime_type=doc.mime_type,
        size_bytes=doc.size_bytes,
        page_count=doc.page_count,
        status=doc.status,
        progress=doc.progress,
        error=doc.error,
        job_id=job.id if job else None,
        current_stage=job.current_stage if job else None,
        invoice_count=counts[0],
        issue_count=counts[1],
        archived_at=doc.archived_at,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


def _active(doc: Document) -> bool:
    return doc.status in ("queued", "processing")


def _stale(doc: Document, settings: Settings) -> bool:
    """Queued or processing with no progress for LEDQUILL_STALE_JOB_MINUTES. Progress is any
    update to the document row (stage ends, page batches), so a long OCR run is not stale."""
    limit = datetime.now(UTC) - timedelta(minutes=settings.ledquill_stale_job_minutes)
    return _active(doc) and doc.updated_at < limit


def _refuse_if_active(doc: Document, settings: Settings, action: str) -> None:
    if _active(doc) and not _stale(doc, settings):
        raise AppError(
            409,
            f"Cannot {action}: the document is still {doc.status}. It becomes eligible after "
            f"{settings.ledquill_stale_job_minutes} minutes without progress.",
        )


def _lock_document(session: Session, document_id: uuid.UUID) -> Document:
    doc = session.scalars(
        select(Document).where(Document.id == document_id).with_for_update()
    ).first()
    if doc is None:
        raise AppError(404, "Document not found.")
    return doc


def reprocess_document(session: Session, document_id: uuid.UUID, settings: Settings) -> Job:
    """Queue a new `reprocess` job. Refused with 409 while a job is making progress, and when it
    would destroy reviewer work: the run rebuilds the invoices, which deletes their corrections
    and approvals. A stale job (no progress past the timeout) may be superseded. Re-running the
    stages is idempotent, so no duplicate invoices appear."""
    doc = _lock_document(session, document_id)
    _refuse_if_active(doc, settings, "reprocess")
    archived = session.scalar(
        select(func.count(Invoice.id)).where(
            Invoice.document_id == doc.id, Invoice.archived_at.is_not(None)
        )
    )
    if doc.archived_at is not None or archived:
        raise AppError(
            409,
            "Cannot reprocess: reprocessing rebuilds the invoices and would permanently remove "
            "archived ones. Restore the document and its archived invoices first.",
        )

    corrections = session.scalar(
        select(func.count(Correction.id))
        .join(Invoice, Correction.invoice_id == Invoice.id)
        .where(Invoice.document_id == doc.id)
    )
    approved = session.scalar(
        select(func.count(Invoice.id)).where(
            Invoice.document_id == doc.id, Invoice.status == "approved"
        )
    )
    if corrections or approved:
        raise AppError(
            409,
            "Cannot reprocess: reprocessing rebuilds the invoices and would discard "
            f"{corrections} reviewer correction(s) and {approved} approval(s) on this document.",
            extra={"corrections": corrections, "approved_invoices": approved},
        )

    for old in session.scalars(
        select(Job).where(Job.document_id == doc.id, Job.status.in_(("queued", "processing")))
    ):
        old.status = "failed"
        old.error = "Superseded by a reprocess after no progress."
        old.finished_at = datetime.now(UTC)
    job = Job(id=uuid.uuid4(), document_id=doc.id, kind="reprocess", status="queued", attempts=0)
    doc.status, doc.progress, doc.error = "queued", 0, None
    session.add(job)
    session.commit()
    try:
        process_document.delay(str(doc.id), str(job.id))
    except KombuError as exc:
        log.error("enqueue_failed", document_id=str(doc.id), job_id=str(job.id))
        reason = "Processing queue is unavailable. Try again shortly."
        doc.status, doc.error = "failed", reason
        job.status, job.error = "failed", reason
        session.commit()
        raise AppError(503, reason) from exc
    return job


def delete_document(
    session: Session, document_id: uuid.UUID, storage: Storage, settings: Settings
) -> None:
    """Remove the document with its invoices, corrections, events, jobs and stored file.
    Refused with 409 while a job is making progress. Rows go first: a leftover file is harmless,
    a row pointing at a missing file is not."""
    doc = _lock_document(session, document_id)
    _refuse_if_active(doc, settings, "delete")
    key = doc.storage_key
    delete_document_invoices(session, doc.id)  # also clears duplicate flags on other invoices
    session.delete(doc)  # the database cascades to pages, jobs, events and invoices
    session.commit()
    log.info("document_deleted", document_id=str(document_id))
    try:
        storage.delete(key)
    except (OSError, TransientError) as exc:
        log.warning("storage_delete_failed", document_id=str(document_id), error=type(exc).__name__)
