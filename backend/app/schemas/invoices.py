"""API contract for /invoices: read models, the correction request and list responses."""

import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)


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


class CorrectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    field: str
    old_value: str | None
    new_value: str | None
    note: str | None
    created_at: datetime


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
    corrected_fields: list[str]  # fields a reviewer changed
    line_items: list[LineItemOut]
    issues: list[IssueOut]
    corrections: list[CorrectionOut]
    created_at: datetime
    updated_at: datetime


class InvoiceList(BaseModel):
    items: list[InvoiceOut]
    total: int
    limit: int
    offset: int


# --- PATCH /invoices/{id} request ---------------------------------------------------------


def _decimal_string_only(value: Any) -> Any:
    """Money travels as a JSON string. A JSON number would already be a float: refuse it."""
    if value is None or isinstance(value, Decimal):
        return value
    if isinstance(value, str):
        return value.strip()
    raise ValueError('send money as a decimal string, for example "1150.00"')


Money = Annotated[
    Decimal, BeforeValidator(_decimal_string_only), Field(max_digits=14, decimal_places=2)
]
Quantity = Annotated[
    Decimal, BeforeValidator(_decimal_string_only), Field(max_digits=14, decimal_places=4)
]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


def _iso_date_only(value: Any) -> Any:
    """YYYY-MM-DD only: pydantic would also accept a Unix timestamp or a compact form."""
    if value is None or isinstance(value, date):
        return value
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value.strip()):
        return value.strip()
    raise ValueError("send the date as YYYY-MM-DD")


IsoDate = Annotated[date, BeforeValidator(_iso_date_only)]
CurrencyCode = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{3}$")
]


class LineItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = (
        None
    )
    quantity: Quantity | None = None
    unit_price: Quantity | None = None
    amount: Money | None = None


class InvoiceCorrection(BaseModel):
    """Only the fields present are changed; `null` clears a field. Unknown fields are a 422."""

    model_config = ConfigDict(extra="forbid")

    invoice_number: Text | None = None
    invoice_date: IsoDate | None = None
    supplier_name: Text | None = None
    customer_name: Text | None = None
    currency: CurrencyCode | None = None
    subtotal: Money | None = None
    tax: Money | None = None
    total: Money | None = None
    line_items: Annotated[list[LineItemIn], Field(max_length=500)] | None = None
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None

    @model_validator(mode="after")
    def _something_to_change(self) -> "InvoiceCorrection":
        if not self.model_fields_set - {"note"}:
            raise ValueError("send at least one invoice field to correct")
        if "line_items" in self.model_fields_set and self.line_items is None:
            raise ValueError("line_items cannot be null; send [] to remove every line")
        return self
