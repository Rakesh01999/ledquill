"""API contract for GET /stats."""

from pydantic import BaseModel


class DocumentStats(BaseModel):
    total: int
    by_status: dict[str, int]  # queued | processing | completed | failed


class InvoiceStats(BaseModel):
    total: int
    by_status: dict[str, int]  # needs_review | ready | approved


class Stats(BaseModel):
    documents: DocumentStats
    invoices: InvoiceStats
    needs_review: int
    success_rate: float | None  # completed / (completed + failed); null until one has finished
    failure_rate: float | None
    avg_processing_seconds: float | None  # completed jobs, started_at to finished_at
    avg_stage_ms: dict[str, int]  # successful stage runs, by stage
