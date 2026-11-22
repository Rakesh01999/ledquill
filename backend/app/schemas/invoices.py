"""Read-only API contract for /invoices (minimal slice pulled forward from P4)."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class LineItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    line_no: int
    description: str | None
    quantity: Decimal | None
    unit_price: Decimal | None
    amount: Decimal | None


class IssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rule_id: str
    severity: str  # error | warning
    field: str | None
    expected: str | None
    actual: str | None
    message: str
    related_invoice_id: uuid.UUID | None


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    page_numbers: list[int] | None
    invoice_number: str | None
    invoice_date: date | None
    supplier_name: str | None
    customer_name: str | None
    currency: str | None
    subtotal: Decimal | None
    tax: Decimal | None
    total: Decimal | None
    confidence: dict[str, float]
    method: str | None
    model: str | None
    status: str  # needs_review | ready | approved
    line_items: list[LineItemOut]
    issues: list[IssueOut]
    created_at: datetime
    updated_at: datetime


class InvoiceList(BaseModel):
    items: list[InvoiceOut]
    total: int
