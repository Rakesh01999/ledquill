"""POST /documents (upload) and GET /documents/{id} (status)."""

import hashlib
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import APIRouter, Depends, File, UploadFile
from kombu.exceptions import KombuError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, TransientError, problem
from app.core.files import sanitize_filename, storage_key
from app.core.logging import get_logger
from app.core.security import require_api_key
from app.core.settings import Settings, get_settings
from app.db.models import Document, Job
from app.db.session import get_session
from app.pipeline.detect import (
    HEAD_BYTES,
    EmptyFileError,
    UnsupportedFileError,
    detect,
)
from app.schemas.documents import AcceptedFile, DocumentOut, RejectedFile, UploadResponse
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
def upload_documents(
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


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: uuid.UUID, session: Session = Depends(get_session)):
    doc = session.get(Document, document_id)
    if doc is None:
        raise AppError(404, "Document not found.")
    job = session.scalars(
        select(Job).where(Job.document_id == doc.id).order_by(Job.started_at.desc().nullsfirst())
    ).first()
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
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )
