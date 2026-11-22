"""The extraction contract (design.md section 4): what the model returns and what we store.

Validation is lenient about representation (a thousands separator, an empty string or an
unparseable date becomes a parsed value or None) and strict about structure (wrong container
types are rejected, so the model is asked once more). Money is Decimal, never float.
"""

import re
from datetime import date
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.pipeline.numbers import parse_amount

FIELDS = (
    "invoice_number",
    "invoice_date",
    "supplier_name",
    "customer_name",
    "currency",
    "subtotal",
    "tax",
    "total",
)
REQUIRED_FIELDS = ("invoice_number", "invoice_date", "supplier_name", "total")
_CURRENCY = re.compile(r"^[A-Z]{3}$")


def _decimal(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return parse_amount(value) if value else None
    if isinstance(value, bool):
        return None
    return value


class LineItemData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    description: str | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    amount: Decimal | None = None

    _numbers = field_validator("quantity", "unit_price", "amount", mode="before")(_decimal)

    @field_validator("description", mode="before")
    @classmethod
    def _text(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip() or None
        return value


class Confidence(BaseModel):
    model_config = ConfigDict(extra="ignore")

    invoice_number: float = Field(0.0, ge=0.0, le=1.0)
    invoice_date: float = Field(0.0, ge=0.0, le=1.0)
    supplier_name: float = Field(0.0, ge=0.0, le=1.0)
    customer_name: float = Field(0.0, ge=0.0, le=1.0)
    currency: float = Field(0.0, ge=0.0, le=1.0)
    subtotal: float = Field(0.0, ge=0.0, le=1.0)
    tax: float = Field(0.0, ge=0.0, le=1.0)
    total: float = Field(0.0, ge=0.0, le=1.0)

    @field_validator("*", mode="before")
    @classmethod
    def _none_is_zero(cls, value: Any) -> Any:
        return 0.0 if value is None else value


class ExtractionResult(BaseModel):
    """Invoice fields plus a 0..1 confidence per field."""

    model_config = ConfigDict(extra="ignore")

    invoice_number: str | None = None
    invoice_date: date | None = None
    supplier_name: str | None = None
    customer_name: str | None = None
    currency: str | None = None
    subtotal: Decimal | None = None
    tax: Decimal | None = None
    total: Decimal | None = None
    line_items: list[LineItemData] = Field(default_factory=list)
    confidence: Confidence = Field(default_factory=Confidence)

    _numbers = field_validator("subtotal", "tax", "total", mode="before")(_decimal)

    @field_validator("invoice_number", "supplier_name", "customer_name", mode="before")
    @classmethod
    def _text(cls, value: Any) -> Any:
        if isinstance(value, str):
            return " ".join(value.split()) or None
        return value

    @field_validator("currency", mode="before")
    @classmethod
    def _currency(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return None
        code = value.strip().upper()
        return code if _CURRENCY.match(code) else None

    @field_validator("invoice_date", mode="before")
    @classmethod
    def _date(cls, value: Any) -> Any:
        if isinstance(value, str):
            try:
                return date.fromisoformat(value.strip()[:10])
            except ValueError:
                return None
        return value

    @field_validator("line_items", mode="before")
    @classmethod
    def _items(cls, value: Any) -> Any:
        return [] if value is None else value

    def confidence_map(self) -> dict[str, float]:
        return self.confidence.model_dump()
