"""API contract for /documents."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class AcceptedFile(BaseModel):
    filename: str
    document_id: uuid.UUID
    job_id: uuid.UUID
    status: str  # queued


class RejectedFile(BaseModel):
    filename: str
    status: int  # the HTTP status this file would have earned alone: 400, 413, 415, 503
    reason: str


class UploadResponse(BaseModel):
    accepted: list[AcceptedFile]
    rejected: list[RejectedFile]


class DocumentOut(BaseModel):
    id: uuid.UUID
    filename: str
    file_type: str
    mime_type: str
    size_bytes: int
    page_count: int | None
    status: str
    progress: int
    error: str | None
    job_id: uuid.UUID | None
    current_stage: str | None
    created_at: datetime
    updated_at: datetime
