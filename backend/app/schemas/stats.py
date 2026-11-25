"""API contract for GET /stats and GET /stats/trends."""

from datetime import date
from decimal import Decimal
from typing import Literal

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


class Amount(BaseModel):
    """A sum in one currency. Currencies are never added together."""

    currency: str
    total: Decimal


class TrendPoint(BaseModel):
    period: date  # first day of the day / ISO week (Monday) / month
    count: int


class SupplierTotal(BaseModel):
    supplier: str  # exact name, as GET /invoices?supplier_exact= takes it
    count: int
    amounts: list[Amount]


class CurrencyTotal(BaseModel):
    currency: str
    count: int
    total: Decimal


class Trends(BaseModel):
    """Live (not archived) invoices whose invoice_date is inside the range; no range = all."""

    date_from: date | None  # the range asked for
    date_to: date | None
    range_start: date | None  # first and last invoice date actually found
    range_end: date | None
    bucket: Literal["day", "week", "month"]
    total: int  # invoices in range
    undated: int  # invoices with no date (only counted when no range is asked for)
    unknown_currency: int
    by_status: dict[str, int]  # needs_review | ready | approved
    series: list[TrendPoint]  # one point per bucket, empty buckets included
    top_suppliers: list[SupplierTotal]
    currencies: list[CurrencyTotal]
