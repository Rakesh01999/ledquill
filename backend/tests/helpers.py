"""Test helpers shared by unit, API and integration tests."""

import hashlib
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import Document, Job
from app.pipeline.detect import HEAD_BYTES, detect
from app.storage import get_storage


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
