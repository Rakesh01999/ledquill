"""Stage 5: validation rules V-01 to V-09 (requirements.md section 7). Pure functions.

Validation compares printed numbers; it never computes or fills a missing value. Every issue
says what was expected and what was found, in plain words.
"""

import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from rapidfuzz import fuzz

from app.schemas.extraction import REQUIRED_FIELDS

MIN_DATE = date(2000, 1, 1)
LOW_CONFIDENCE = 0.7
SUPPLIER_MATCH_RATIO = 70  # same invoice number + a similar supplier name = same invoice
_LABELS = {
    "invoice_number": "Invoice number",
    "invoice_date": "Invoice date",
    "supplier_name": "Supplier name",
    "total": "Total",
    "subtotal": "Subtotal",
    "tax": "Tax",
}
_CENT = Decimal("0.01")
# Common ISO 4217 codes; a code outside this list is a warning, not an error.
ISO_4217 = frozenset(
    [
        "AED",
        "AUD",
        "BDT",
        "BGN",
        "BRL",
        "CAD",
        "CHF",
        "CNY",
        "CZK",
        "DKK",
        "EUR",
        "GBP",
        "HKD",
        "HUF",
        "IDR",
        "ILS",
        "INR",
        "JPY",
        "KRW",
        "LKR",
        "MXN",
        "MYR",
        "NGN",
        "NOK",
        "NPR",
        "NZD",
        "PHP",
        "PKR",
        "PLN",
        "RON",
        "RUB",
        "SAR",
        "SEK",
        "SGD",
        "THB",
        "TRY",
        "TWD",
        "UAH",
        "USD",
        "VND",
        "ZAR",
    ]
)


@dataclass(frozen=True)
class LineData:
    description: str | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    amount: Decimal | None = None


@dataclass(frozen=True)
class InvoiceData:
    invoice_number: str | None = None
    invoice_date: date | None = None
    supplier_name: str | None = None
    currency: str | None = None
    subtotal: Decimal | None = None
    tax: Decimal | None = None
    total: Decimal | None = None
    line_items: Sequence[LineData] = ()
    confidence: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Issue:
    rule_id: str
    severity: str  # error | warning
    message: str
    field: str | None = None
    expected: str | None = None
    actual: str | None = None
    related_invoice_id: uuid.UUID | None = None


@dataclass(frozen=True)
class Candidate:
    """Another stored invoice that may be the same one."""

    invoice_id: uuid.UUID
    document_id: uuid.UUID
    filename: str
    sha256: str
    invoice_number: str | None
    invoice_date: date | None
    supplier_norm: str | None
    total: Decimal | None


def normalize_supplier(name: str | None) -> str | None:
    if not name:
        return None
    cleaned = " ".join(re.sub(r"[^\w\s]", " ", name.casefold()).split())
    return cleaned or None


def money(value: Decimal) -> str:
    return f"{value:,.2f}"


def within_tolerance(a: Decimal, b: Decimal) -> bool:
    """abs(a - b) <= max(0.01, 0.5% of b)."""
    return abs(a - b) <= max(_CENT, Decimal("0.005") * abs(b))


def validate_fields(
    inv: InvoiceData,
    *,
    today: date | None = None,
    llm_unavailable: bool = False,
    injection_lines: int = 0,
    poor_scan: bool = False,
) -> list[Issue]:
    """V-01 to V-06 and V-08 for one invoice."""
    today = today or date.today()
    issues: list[Issue] = []
    values = {f: getattr(inv, f) for f in REQUIRED_FIELDS}

    for name in REQUIRED_FIELDS:  # V-01
        if values[name] is None:
            label = _LABELS[name]
            issues.append(
                Issue(
                    "V-01",
                    "error",
                    f"{label} is missing: it is required but was not found in the document.",
                    name,
                    "a value",
                    "missing",
                )
            )

    if inv.currency is not None and inv.currency not in ISO_4217:  # V-02
        issues.append(
            Issue(
                "V-02",
                "warning",
                f"The currency code {inv.currency} is not a recognised ISO 4217 code.",
                "currency",
                "an ISO 4217 code such as USD or EUR",
                inv.currency,
            )
        )
    for name in ("subtotal", "tax", "total"):  # V-02
        value = getattr(inv, name)
        if value is not None and value < 0:
            issues.append(
                Issue(
                    "V-02",
                    "error",
                    f"{_LABELS[name]} is negative ({money(value)}); amounts must be zero or more.",
                    name,
                    "0.00 or more",
                    money(value),
                )
            )
    for n, line in enumerate(inv.line_items, 1):
        for name in ("quantity", "unit_price", "amount"):
            value = getattr(line, name)
            if value is not None and value < 0:
                issues.append(
                    Issue(
                        "V-02",
                        "error",
                        f"Line {n} has a negative {name.replace('_', ' ')} ({value}).",
                        f"line_items[{n}].{name}",
                        "0 or more",
                        str(value),
                    )
                )

    for n, line in enumerate(inv.line_items, 1):  # V-03
        if None in (line.quantity, line.unit_price, line.amount):
            continue
        expected = (line.quantity * line.unit_price).quantize(_CENT)
        if abs(expected - line.amount) > _CENT:
            issues.append(
                Issue(
                    "V-03",
                    "warning",
                    f"Line {n}: quantity {line.quantity} x unit price {line.unit_price} "
                    f"should be {money(expected)}, but the line amount is {money(line.amount)}.",
                    f"line_items[{n}].amount",
                    money(expected),
                    money(line.amount),
                )
            )

    amounts = [line.amount for line in inv.line_items]  # V-04
    if inv.subtotal is not None and amounts and None not in amounts:
        line_sum = sum(amounts, Decimal(0))
        if not within_tolerance(line_sum, inv.subtotal):
            issues.append(
                Issue(
                    "V-04",
                    "error",
                    f"The line items add up to {money(line_sum)}, but the subtotal is "
                    f"{money(inv.subtotal)}.",
                    "subtotal",
                    money(line_sum),
                    money(inv.subtotal),
                )
            )

    if None not in (inv.subtotal, inv.tax, inv.total):  # V-05
        expected_total = inv.subtotal + inv.tax
        if not within_tolerance(expected_total, inv.total):
            issues.append(
                Issue(
                    "V-05",
                    "error",
                    f"Subtotal {money(inv.subtotal)} plus tax {money(inv.tax)} is "
                    f"{money(expected_total)}, but the total is {money(inv.total)}.",
                    "total",
                    money(expected_total),
                    money(inv.total),
                )
            )

    if inv.invoice_date is not None:  # V-06
        if inv.invoice_date > today:
            issues.append(
                Issue(
                    "V-06",
                    "warning",
                    f"The invoice date {inv.invoice_date} is in the future.",
                    "invoice_date",
                    f"on or before {today}",
                    str(inv.invoice_date),
                )
            )
        elif inv.invoice_date < MIN_DATE:
            issues.append(
                Issue(
                    "V-06",
                    "warning",
                    f"The invoice date {inv.invoice_date} is before {MIN_DATE.year}.",
                    "invoice_date",
                    f"{MIN_DATE} or later",
                    str(inv.invoice_date),
                )
            )

    for name in REQUIRED_FIELDS:  # V-08, only for values that were found
        conf = inv.confidence.get(name, 0.0)
        if values[name] is not None and conf < LOW_CONFIDENCE:
            issues.append(
                Issue(
                    "V-08",
                    "warning",
                    f"{_LABELS[name]} was read with low confidence ({conf:.2f}); please check it.",
                    name,
                    f"confidence of {LOW_CONFIDENCE} or more",
                    f"{conf:.2f}",
                )
            )
    if llm_unavailable:
        issues.append(
            Issue(
                "V-08",
                "warning",
                "The language model was unavailable, so only pattern-matched values were kept; "
                "please review every field.",
                None,
                "model-checked values",
                "pattern-matched values only",
            )
        )
    if poor_scan:
        issues.append(
            Issue(
                "V-08",
                "warning",
                "The scan was too poor to read: almost no text was recognised. Please enter the "
                "values from the original file, or upload a clearer scan.",
                None,
                "readable text",
                "almost no text recognised",
            )
        )
    if injection_lines:
        issues.append(
            Issue(
                "V-08",
                "warning",
                f"The document contains {injection_lines} line(s) that look like instructions to "
                "an AI system. They were ignored; please check the values against the document.",
                None,
                "invoice content only",
                f"{injection_lines} instruction-like line(s)",
            )
        )
    return issues


def duplicate_issues(
    inv: InvoiceData,
    *,
    document_id: uuid.UUID,
    sha256: str,
    candidates: Iterable[Candidate],
) -> list[Issue]:
    """V-07: the same file already stored, or the same supplier + invoice number."""
    supplier = normalize_supplier(inv.supplier_name)
    by_hash: Candidate | None = None
    by_key: Candidate | None = None
    for c in candidates:
        same_number = bool(inv.invoice_number) and c.invoice_number == inv.invoice_number
        if c.document_id != document_id and c.sha256 == sha256 and (by_hash is None or same_number):
            by_hash = c
        if (
            inv.invoice_number
            and supplier
            and c.invoice_number == inv.invoice_number
            and c.supplier_norm == supplier
            and by_key is None
        ):
            by_key = c
    issues: list[Issue] = []
    if by_hash:
        issues.append(
            Issue(
                "V-07",
                "error",
                f'This exact file was already uploaded as "{by_hash.filename}".',
                None,
                "a file not stored before",
                f"same file as {by_hash.filename}",
                by_hash.invoice_id,
            )
        )
    elif by_key:
        issues.append(
            Issue(
                "V-07",
                "error",
                f"An invoice with number {inv.invoice_number} from {inv.supplier_name} is "
                f'already stored (from "{by_key.filename}").',
                "invoice_number",
                "a new invoice number for this supplier",
                f"{inv.invoice_number} already stored",
                by_key.invoice_id,
            )
        )
    return issues


def cross_check_issues(
    inv: InvoiceData, *, document_id: uuid.UUID, candidates: Iterable[Candidate]
) -> list[Issue]:
    """V-09: the same invoice in another document must agree on total, date and supplier."""
    if not inv.invoice_number:
        return []
    supplier = normalize_supplier(inv.supplier_name)
    issues: list[Issue] = []
    for c in candidates:
        if c.document_id == document_id or c.invoice_number != inv.invoice_number:
            continue
        if (
            supplier
            and c.supplier_norm
            and supplier != c.supplier_norm
            and fuzz.token_set_ratio(supplier, c.supplier_norm) < SUPPLIER_MATCH_RATIO
        ):
            continue  # a different supplier happens to use the same number
        where = f'"{c.filename}"'
        if (
            inv.total is not None
            and c.total is not None
            and abs(inv.total - c.total) > _CENT  # two sources must agree to the cent
        ):
            issues.append(
                Issue(
                    "V-09",
                    "error",
                    f"The total is {money(inv.total)} here but {money(c.total)} in {where}.",
                    "total",
                    money(c.total),
                    money(inv.total),
                    c.invoice_id,
                )
            )
        if inv.invoice_date and c.invoice_date and inv.invoice_date != c.invoice_date:
            issues.append(
                Issue(
                    "V-09",
                    "error",
                    f"The invoice date is {inv.invoice_date} here but {c.invoice_date} in {where}.",
                    "invoice_date",
                    str(c.invoice_date),
                    str(inv.invoice_date),
                    c.invoice_id,
                )
            )
        if supplier and c.supplier_norm and supplier != c.supplier_norm:
            issues.append(
                Issue(
                    "V-09",
                    "error",
                    f'The supplier is "{inv.supplier_name}" here but "{c.supplier_norm}" '
                    f"in {where}.",
                    "supplier_name",
                    c.supplier_norm,
                    supplier,
                    c.invoice_id,
                )
            )
    return issues


def derive_status(issues: Iterable[Issue | object]) -> str:
    """needs_review: any error, two or more warnings, or any low-confidence (V-08) issue."""
    issues = list(issues)
    errors = sum(1 for i in issues if i.severity == "error")
    warnings = sum(1 for i in issues if i.severity == "warning")
    low_confidence = any(i.rule_id == "V-08" for i in issues)
    return "needs_review" if errors or warnings >= 2 or low_confidence else "ready"
