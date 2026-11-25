"""GET /stats: dashboard numbers, all computed in SQL."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import require_api_key
from app.db.models import Document, Invoice, Job, ProcessingEvent
from app.db.session import get_session
from app.schemas.stats import (
    Amount,
    CurrencyTotal,
    DocumentStats,
    InvoiceStats,
    Stats,
    SupplierTotal,
    TrendPoint,
    Trends,
)

router = APIRouter(tags=["stats"], dependencies=[Depends(require_api_key)])
DOCUMENT_STATUSES = ("queued", "processing", "completed", "failed")
INVOICE_STATUSES = ("needs_review", "ready", "approved")


def _counts(session: Session, column, statuses: tuple[str, ...], live) -> dict[str, int]:
    """Counts per status over live (not archived) rows only."""
    found = dict(session.execute(select(column, func.count()).where(live).group_by(column)).all())
    return {s: found.get(s, 0) for s in statuses}


@router.get("/stats", response_model=Stats)
def get_stats(session: Session = Depends(get_session)):
    documents = _counts(session, Document.status, DOCUMENT_STATUSES, Document.archived_at.is_(None))
    invoices = _counts(session, Invoice.status, INVOICE_STATUSES, Invoice.archived_at.is_(None))
    finished = documents["completed"] + documents["failed"]
    avg_seconds = session.scalar(
        select(func.avg(func.extract("epoch", Job.finished_at - Job.started_at)))
        .join(Document, Document.id == Job.document_id)
        .where(
            Job.status == "completed",
            Job.started_at.is_not(None),
            Job.finished_at.is_not(None),
            Document.archived_at.is_(None),
        )
    )
    stage_ms = session.execute(
        select(ProcessingEvent.stage, func.avg(ProcessingEvent.duration_ms))
        .join(Document, Document.id == ProcessingEvent.document_id)
        .where(
            ProcessingEvent.status == "succeeded",
            ProcessingEvent.duration_ms.is_not(None),
            Document.archived_at.is_(None),
        )
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


TOP_SUPPLIERS = 8


def _bucket_for(span_days: int) -> Literal["day", "week", "month"]:
    """Day up to a month, week up to about six months, month beyond (keeps the chart readable)."""
    if span_days <= 31:
        return "day"
    return "week" if span_days <= 190 else "month"


def _period_start(day: date, bucket: str) -> date:
    if bucket == "week":
        return day - timedelta(days=day.weekday())
    if bucket == "month":
        return day.replace(day=1)
    return day


def _next_period(day: date, bucket: str) -> date:
    if bucket == "day":
        return day + timedelta(days=1)
    if bucket == "week":
        return day + timedelta(days=7)
    return date(day.year + (day.month == 12), day.month % 12 + 1, 1)


@router.get("/stats/trends", response_model=Trends)
def get_trends(
    date_from: date | None = None,
    date_to: date | None = None,
    session: Session = Depends(get_session),
):
    """Invoices over time, top suppliers and the currency split, for the dashboard. The range
    applies to invoice_date, like `date_from` / `date_to` on GET /invoices, so every number here can
    be reproduced by that list. Money is summed per currency, never across currencies."""
    if date_from and date_to and date_from > date_to:
        raise AppError(422, "date_from must not be after date_to.")
    live = [Invoice.archived_at.is_(None)]
    if date_from:
        live.append(Invoice.invoice_date >= date_from)
    if date_to:
        live.append(Invoice.invoice_date <= date_to)

    total = session.scalar(select(func.count()).select_from(Invoice).where(*live)) or 0
    undated = (
        0
        if date_from or date_to
        else session.scalar(
            select(func.count()).select_from(Invoice).where(*live, Invoice.invoice_date.is_(None))
        )
        or 0
    )
    found_lo, found_hi = session.execute(
        select(func.min(Invoice.invoice_date), func.max(Invoice.invoice_date)).where(*live)
    ).one()
    start, end = date_from or found_lo, date_to or found_hi

    by_status = dict(
        session.execute(
            select(Invoice.status, func.count()).where(*live).group_by(Invoice.status)
        ).all()
    )
    by_status = {s: by_status.get(s, 0) for s in INVOICE_STATUSES}

    bucket = _bucket_for((end - start).days) if start and end else "month"
    series: list[TrendPoint] = []
    if start and end:
        period = cast(func.date_trunc(bucket, Invoice.invoice_date), Date)
        counts = dict(
            session.execute(
                select(period, func.count())
                .where(*live, Invoice.invoice_date.is_not(None))
                .group_by(period)
            ).all()
        )
        day = _period_start(start, bucket)
        while day <= end:
            series.append(TrendPoint(period=day, count=counts.get(day, 0)))
            day = _next_period(day, bucket)

    top = session.execute(
        select(Invoice.supplier_name, func.count().label("n"))
        .where(*live, Invoice.supplier_name.is_not(None), Invoice.supplier_name != "")
        .group_by(Invoice.supplier_name)
        .order_by(func.count().desc(), Invoice.supplier_name)
        .limit(TOP_SUPPLIERS)
    ).all()
    amounts: dict[str, list[Amount]] = {name: [] for name, _ in top}
    if top:
        rows = session.execute(
            select(Invoice.supplier_name, Invoice.currency, func.sum(Invoice.total))
            .where(*live, Invoice.supplier_name.in_(amounts), Invoice.currency.is_not(None))
            .group_by(Invoice.supplier_name, Invoice.currency)
            .having(func.sum(Invoice.total).is_not(None))
            .order_by(Invoice.supplier_name, Invoice.currency)
        ).all()
        for name, currency, amount in rows:
            amounts[name].append(Amount(currency=currency, total=amount))

    currencies = [
        CurrencyTotal(currency=c, count=n, total=amount or 0)
        for c, n, amount in session.execute(
            select(Invoice.currency, func.count(), func.sum(Invoice.total))
            .where(*live, Invoice.currency.is_not(None))
            .group_by(Invoice.currency)
            .order_by(func.count().desc(), Invoice.currency)
        ).all()
    ]
    unknown_currency = (
        session.scalar(
            select(func.count()).select_from(Invoice).where(*live, Invoice.currency.is_(None))
        )
        or 0
    )
    return Trends(
        date_from=date_from,
        date_to=date_to,
        range_start=found_lo,
        range_end=found_hi,
        bucket=bucket,
        total=total,
        undated=undated,
        unknown_currency=unknown_currency,
        by_status=by_status,
        series=series,
        top_suppliers=[
            SupplierTotal(supplier=name, count=n, amounts=amounts[name]) for name, n in top
        ],
        currencies=currencies,
    )
