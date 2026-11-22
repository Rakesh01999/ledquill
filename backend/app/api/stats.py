"""GET /stats: dashboard numbers, all computed in SQL."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import require_api_key
from app.db.models import Document, Invoice, Job, ProcessingEvent
from app.db.session import get_session
from app.schemas.stats import DocumentStats, InvoiceStats, Stats

router = APIRouter(tags=["stats"], dependencies=[Depends(require_api_key)])
DOCUMENT_STATUSES = ("queued", "processing", "completed", "failed")
INVOICE_STATUSES = ("needs_review", "ready", "approved")


def _counts(session: Session, column, statuses: tuple[str, ...]) -> dict[str, int]:
    found = dict(session.execute(select(column, func.count()).group_by(column)).all())
    return {s: found.get(s, 0) for s in statuses}


@router.get("/stats", response_model=Stats)
def get_stats(session: Session = Depends(get_session)):
    documents = _counts(session, Document.status, DOCUMENT_STATUSES)
    invoices = _counts(session, Invoice.status, INVOICE_STATUSES)
    finished = documents["completed"] + documents["failed"]
    avg_seconds = session.scalar(
        select(func.avg(func.extract("epoch", Job.finished_at - Job.started_at))).where(
            Job.status == "completed", Job.started_at.is_not(None), Job.finished_at.is_not(None)
        )
    )
    stage_ms = session.execute(
        select(ProcessingEvent.stage, func.avg(ProcessingEvent.duration_ms))
        .where(ProcessingEvent.status == "succeeded", ProcessingEvent.duration_ms.is_not(None))
        .group_by(ProcessingEvent.stage)
    )
    return Stats(
        documents=DocumentStats(total=sum(documents.values()), by_status=documents),
        invoices=InvoiceStats(total=sum(invoices.values()), by_status=invoices),
        needs_review=invoices["needs_review"],
        success_rate=round(documents["completed"] / finished, 4) if finished else None,
        failure_rate=round(documents["failed"] / finished, 4) if finished else None,
        avg_processing_seconds=round(float(avg_seconds), 2) if avg_seconds is not None else None,
        avg_stage_ms={stage: round(float(ms)) for stage, ms in stage_ms},
    )
