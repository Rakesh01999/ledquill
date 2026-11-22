"""Index stage helpers: the text that keyword and semantic search read."""

from collections.abc import Iterable
from datetime import date
from decimal import Decimal


def build_search_text(
    *,
    invoice_number: str | None,
    supplier_name: str | None,
    customer_name: str | None,
    currency: str | None,
    invoice_date: date | None,
    total: Decimal | None,
    descriptions: Iterable[str | None],
) -> str | None:
    """Fields and line-item descriptions as one string, or None when there is nothing to index."""
    parts = [
        invoice_number,
        supplier_name,
        customer_name,
        currency,
        invoice_date.isoformat() if invoice_date else None,
        f"{total:.2f}" if total is not None else None,
        *descriptions,
    ]
    text = "\n".join(p.strip() for p in parts if p and p.strip())
    return text or None
