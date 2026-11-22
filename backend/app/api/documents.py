"""Documents: upload, list, status, processing events and reprocess."""

import hashlib
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from kombu.exceptions import KombuError
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, TransientError, problem
from app.core.files import sanitize_filename, storage_key
from app.core.logging import get_logger
from app.core.pagination import PageParams, page_params
from app.core.ratelimit import limiter, upload_limit
from app.core.security import require_api_key
from app.core.settings import Settings, get_settings
from app.db.models import Document, Invoice, Job, ProcessingEvent
from app.db.session import get_session
from app.pipeline.detect import (
    HEAD_BYTES,
    EmptyFileError,
    UnsupportedFileError,
    detect,
)
from app.schemas.documents import (
    AcceptedFile,
    DocumentList,
    DocumentOut,
    EventList,
    RejectedFile,
    ReprocessResponse,
    UploadResponse,
)
from app.services.documents import (
    delete_document,
    document_out,
    latest_jobs,
    reprocess_document,
)
from app.services.invoices import InvoiceFilters, invoice_conditions
from app.storage import Storage, get_storage
from app.workers.tasks import process_document

router = APIRouter(prefix="/documents", tags=["documents"], dependencies=[Depends(require_api_key)])
log = get_logger(__name__)
_CHUNK = 1024 * 1024


class FileTooLargeError(Exception):
    pass


@dataclass
class _Stored:
    document: Document
    job: Job


def _chunks(upload: UploadFile, first: bytes, limit: int, digest) -> Iterator[bytes]:
    """Yield the file in chunks, hashing and counting as it goes; stop past the limit."""
    size = 0
    chunk = first
    while chunk:
        size += len(chunk)
        if size > limit:
            raise FileTooLargeError
        digest.update(chunk)
        yield chunk
        chunk = upload.file.read(_CHUNK)


def _store(upload: UploadFile, settings: Settings, storage: Storage) -> _Stored:
    """Detect by content, stream to storage, return unsaved rows. Raises a per-file error."""
    first = upload.file.read(HEAD_BYTES)
    detected = detect(first)  # EmptyFileError / UnsupportedFileError
    name = sanitize_filename(upload.filename)
    doc_id = uuid.uuid4()
    key = storage_key(doc_id, name)
    digest = hashlib.sha256()
    counted = {"bytes": 0}

    def counting() -> Iterator[bytes]:
        for chunk in _chunks(upload, first, settings.max_upload_bytes, digest):
            counted["bytes"] += len(chunk)
            yield chunk

    storage.save(key, counting())
    document = Document(
        id=doc_id,
        filename=name,
        file_type=detected.file_type,
        mime_type=detected.mime_type,
        sha256=digest.hexdigest(),
        size_bytes=counted["bytes"],
        storage_key=key,
        status="queued",
        progress=0,
    )
    job = Job(id=uuid.uuid4(), document_id=doc_id, kind="process", status="queued", attempts=0)
    return _Stored(document, job)


def _reject(filename: str, exc: Exception, settings: Settings) -> RejectedFile:
    if isinstance(exc, EmptyFileError):
        return RejectedFile(filename=filename, status=400, reason="The file is empty.")
    if isinstance(exc, FileTooLargeError):
        limit = settings.ledquill_max_upload_mb
        return RejectedFile(filename=filename, status=413, reason=f"Larger than {limit} MB.")
    if isinstance(exc, TransientError):
        return RejectedFile(
            filename=filename, status=503, reason="File storage is unavailable. Try again shortly."
        )
    return RejectedFile(filename=filename, status=415, reason=str(exc))


@router.post("", status_code=202, response_model=UploadResponse)
@limiter.limit(upload_limit)
def upload_documents(
    request: Request,
    response: Response,
    files: list[UploadFile] = File(default=[]),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    storage: Storage = Depends(get_storage),
):
    uploads = files
    if not uploads:
        raise AppError(400, "No files were uploaded. Send them as multipart field 'files'.")
    if len(uploads) > settings.ledquill_max_files_per_request:
        raise AppError(400, f"At most {settings.ledquill_max_files_per_request} files per request.")

    stored: list[_Stored] = []
    rejected: list[RejectedFile] = []
    for upload in uploads:
        display_name = sanitize_filename(upload.filename)
        try:
            stored.append(_store(upload, settings, storage))
        except (EmptyFileError, UnsupportedFileError, FileTooLargeError, TransientError) as exc:
            rejected.append(_reject(display_name, exc, settings))
        finally:
            upload.file.close()

    if stored:
        session.add_all([s.document for s in stored])
        session.flush()  # documents first: jobs reference them
        session.add_all([s.job for s in stored])
        session.commit()

    accepted: list[AcceptedFile] = []
    for item in stored:
        try:
            process_document.delay(str(item.document.id), str(item.job.id))
        except KombuError:
            log.error("enqueue_failed", document_id=str(item.document.id))
            reason = "Processing queue is unavailable. Please upload again shortly."
            item.document.status, item.document.error = "failed", reason
            item.job.status, item.job.error = "failed", reason
            session.commit()
            rejected.append(
                RejectedFile(filename=item.document.filename, status=503, reason=reason)
            )
            continue
        accepted.append(
            AcceptedFile(
                filename=item.document.filename,
                document_id=item.document.id,
                job_id=item.job.id,
                status="queued",
            )
        )

    if not accepted:
        statuses = {r.status for r in rejected}
        status = statuses.pop() if len(statuses) == 1 else 400
        return problem(
            status,
            "No file was accepted.",
            extra={"rejected": [r.model_dump() for r in rejected]},
        )
    return UploadResponse(accepted=accepted, rejected=rejected)


@router.get("", response_model=DocumentList)
def list_documents(
    status: Literal["queued", "processing", "completed", "failed"] | None = None,
    file_type: Literal["pdf", "image", "xlsx", "xls", "csv"] | None = None,
    supplier: str | None = Query(None, min_length=1, max_length=200),
    currency: str | None = Query(None, pattern=r"^[A-Za-z]{3}$"),
    date_from: date | None = None,
    date_to: date | None = None,
    page: PageParams = Depends(page_params),
    session: Session = Depends(get_session),
):
    """Newest first. supplier, currency and the date range match documents holding at least one
    invoice that satisfies all of them."""
    if date_from and date_to and date_from > date_to:
        raise AppError(422, "date_from must not be after date_to.")
    where = []
    if status:
        where.append(Document.status == status)
    if file_type:
        where.append(Document.file_type == file_type)
    by_invoice = invoice_conditions(
        InvoiceFilters(supplier=supplier, currency=currency, date_from=date_from, date_to=date_to)
    )
    if by_invoice:
        where.append(exists().where(Invoice.document_id == Document.id, *by_invoice))
    total = session.scalar(select(func.count()).select_from(Document).where(*where)) or 0
    docs = session.scalars(
        select(Document)
        .where(*where)
        .order_by(Document.created_at.desc(), Document.id)
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    jobs = latest_jobs(session, [d.id for d in docs])
    return DocumentList(
        items=[document_out(d, jobs.get(d.id)) for d in docs],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: uuid.UUID, session: Session = Depends(get_session)):
    doc = session.get(Document, document_id)
    if doc is None:
        raise AppError(404, "Document not found.")
    return document_out(doc, latest_jobs(session, [doc.id]).get(doc.id))


@router.get("/{document_id}/events", response_model=EventList)
def document_events(
    document_id: uuid.UUID,
    page: PageParams = Depends(page_params),
    session: Session = Depends(get_session),
):
    """Processing history with stage timings, oldest first (FR-17, NFR-06)."""
    if session.get(Document, document_id) is None:
        raise AppError(404, "Document not found.")
    where = ProcessingEvent.document_id == document_id
    total = session.scalar(select(func.count()).select_from(ProcessingEvent).where(where)) or 0
    events = session.scalars(
        select(ProcessingEvent)
        .where(where)
        .order_by(ProcessingEvent.created_at, ProcessingEvent.id)
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return EventList(items=events, total=total, limit=page.limit, offset=page.offset)


@router.post("/{document_id}/reprocess", status_code=202, response_model=ReprocessResponse)
def reprocess(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    job = reprocess_document(session, document_id, settings)
    return ReprocessResponse(document_id=document_id, job_id=job.id, status="queued")


@router.delete("/{document_id}", status_code=204)
def delete(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    storage: Storage = Depends(get_storage),
):
    delete_document(session, document_id, storage, settings)
    return Response(status_code=204)
