"""API contract for /documents."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


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
    invoice_count: int
    issue_count: int  # validation issues across the document's invoices
    created_at: datetime
    updated_at: datetime


class DocumentList(BaseModel):
    items: list[DocumentOut]
    total: int
    limit: int
    offset: int


class PageOut(BaseModel):
    page_no: int  # sheet index for spreadsheets
    method: str  # text|ocr|sheet
    text: str | None
    ocr_confidence: float | None
    has_image: bool  # GET .../pages/{page_no}/image works (PDF and image files)


class PageList(BaseModel):
    items: list[PageOut]
    total: int


class ReprocessResponse(BaseModel):
    document_id: uuid.UUID
    job_id: uuid.UUID
    status: str  # queued


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: uuid.UUID | None
    stage: str  # detect|extract|split|fields|validate|index
    status: str  # started|succeeded|failed
    duration_ms: int | None
    detail: dict | None
    created_at: datetime


class EventList(BaseModel):
    items: list[EventOut]
    total: int
    limit: int
    offset: int


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    kind: str  # process | reprocess
    status: str
    attempts: int
    current_stage: str | None
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
