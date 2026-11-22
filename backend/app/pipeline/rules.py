"""Stage 4a: regex pre-extraction and spreadsheet column mapping (no network, no LLM).

Everything returned here is read straight from the text or a cell, so it is grounded by
construction. The values become `rule_hints` for the prompt and the fallback when every
model fails. Confidences are fixed heuristics, not measured accuracy.
"""

import calendar
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from app.pipeline.numbers import parse_amount

REGEX_CONFIDENCE = 0.75  # labelled pattern in free text
TABLE_CONFIDENCE = 0.95  # a mapped spreadsheet cell

_MONTHS = {n.lower(): i for i, n in enumerate(calendar.month_name) if n}
_MONTHS.update({n.lower(): i for i, n in enumerate(calendar.month_abbr) if n})
_MONTHS["sept"] = 9

_INVOICE_NO = re.compile(
    r"(?i)\b(?:invoice|bill)\s*(?:no\.?|number|num\.?|nr\.?|#)\s*[:#.\-]?(?:[ \t]*\n)?[ \t]*"
    r"([A-Za-z0-9][A-Za-z0-9\-/_.]*)"
)
_DATE_ISO = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})")
_DATE_NUM = re.compile(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b")
_DATE_DMY_TEXT = re.compile(
    r"(\d{1,2})(?:st|nd|rd|th)?[ \-]([A-Za-z]{3,9})\.?,?[ \-](\d{4}|\d{2})\b"
)
_DATE_MDY_TEXT = re.compile(r"([A-Za-z]{3,9})\.? +(\d{1,2})(?:st|nd|rd|th)?,? +(\d{4})\b")
_DATE_LABEL = re.compile(
    r"(?i)(?<!due )(?<!ship )(?<!order )(?<!payment )(?<!delivery )"
    r"\b(invoice\s+date|date\s+of\s+issue|issue\s+date|dated|date)\b\s*[:.\-]?\s*"
)
_DATE_LABEL_ORDER = ("invoice date", "date of issue", "issue date", "dated", "date")

_AMOUNT = (
    r"\s*[:=\-]?\s*(?:[A-Z]{3}\s*)?[$€£৳₹]?\s*"
    r"(\d{1,3}(?:[  ,.']\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d+)?)\s*(?:[A-Z]{3})?\s*$"
)
_PCT = r"(?:\s*\(?\s*\d+(?:[.,]\d+)?\s*%\s*\)?)?"


def _labelled(label: str) -> re.Pattern[str]:
    return re.compile(rf"(?:^|[\s|])(?i:{label})\b{_PCT}{_AMOUNT}")


_SUBTOTAL = _labelled(r"sub[\s\-]?total|net\s+(?:amount|total)|total\s+before\s+tax")
_TAX = _labelled(r"(?:total\s+)?(?:tax|vat|gst|sales\s+tax)(?:\s+amount)?")
_TOTAL_STRONG = _labelled(
    r"grand\s+total|total\s+due|amount\s+due|balance\s+due|invoice\s+total|total\s+amount"
    r"|total\s+payable|amount\s+payable"
)
_TOTAL = _labelled(r"total")

_CODES = [
    "USD",
    "EUR",
    "GBP",
    "BDT",
    "INR",
    "JPY",
    "CNY",
    "CAD",
    "AUD",
    "CHF",
    "SEK",
    "NOK",
    "DKK",
    "NZD",
    "SGD",
    "HKD",
    "AED",
    "SAR",
    "PKR",
    "LKR",
    "MYR",
    "THB",
    "ZAR",
    "BRL",
    "MXN",
    "PLN",
    "CZK",
    "TRY",
]
_CODE_RE = re.compile(r"\b(" + "|".join(_CODES) + r")\b")
_UNAMBIGUOUS_SYMBOLS = {"€": "EUR", "£": "GBP", "৳": "BDT", "₹": "INR"}


@dataclass
class RuleResult:
    """Values found without an LLM. `complete` means a spreadsheet mapped enough columns that
    the LLM adds nothing."""

    values: dict[str, Any] = field(default_factory=dict)
    line_items: list[dict[str, Any]] = field(default_factory=list)
    confidence: float = REGEX_CONFIDENCE
    complete: bool = False


def _to_date(year: int, month: int, day: int) -> date | None:
    if year < 100:
        year += 2000
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date_prefix(text: str) -> date | None:
    """Parse a date at the start of `text`. An ambiguous day/month order returns None."""
    text = text.strip()
    if m := _DATE_ISO.match(text):
        return _to_date(int(m[1]), int(m[2]), int(m[3]))
    if m := _DATE_NUM.match(text):
        first, second, year = int(m[1]), int(m[2]), int(m[3])
        if first > 12 or first == second:
            return _to_date(year, second, first)  # day first
        if second > 12:
            return _to_date(year, first, second)  # month first
        return None  # 03/04/2026 could be either: never guess
    if m := _DATE_DMY_TEXT.match(text):
        month = _MONTHS.get(m[2].lower())
        return _to_date(int(m[3]), month, int(m[1])) if month else None
    if m := _DATE_MDY_TEXT.match(text):
        month = _MONTHS.get(m[1].lower())
        return _to_date(int(m[3]), month, int(m[2])) if month else None
    return None


def find_invoice_number(text: str) -> str | None:
    for m in _INVOICE_NO.finditer(text):
        token = m[1].rstrip(".-/_")
        if any(c.isdigit() for c in token):
            return token
    return None


def _find_date(text: str) -> date | None:
    matches = list(_DATE_LABEL.finditer(text))
    matches.sort(key=lambda m: _DATE_LABEL_ORDER.index(" ".join(m[1].lower().split())))
    for m in matches:
        if parsed := parse_date_prefix(text[m.end() : m.end() + 40]):
            return parsed
    return None


def _find_currency(text: str) -> str | None:
    codes = set(_CODE_RE.findall(text))
    if len(codes) == 1:
        return codes.pop()
    if not codes:
        symbols = {code for sym, code in _UNAMBIGUOUS_SYMBOLS.items() if sym in text}
        if len(symbols) == 1:
            return symbols.pop()
    return None


def _find_amounts(text: str) -> dict[str, Decimal]:
    last: dict[str, Decimal] = {}
    strong: Decimal | None = None
    for raw in text.splitlines():
        line = raw.strip()
        for key, pattern in (("subtotal", _SUBTOTAL), ("tax", _TAX)):
            if m := pattern.search(line):
                if (value := parse_amount(m[1])) is not None:
                    last[key] = value
                break
        else:
            if (m := _TOTAL_STRONG.search(line)) and (value := parse_amount(m[1])) is not None:
                strong = value
            elif (
                not _TOTAL_STRONG.search(line)
                and (m := _TOTAL.search(line))
                and (value := parse_amount(m[1])) is not None
            ):
                last["total"] = value
    if strong is not None:
        last["total"] = strong
    return last


def extract_hints(text: str) -> RuleResult:
    """Regex pass over free text (digital PDF, OCR)."""
    values: dict[str, Any] = {}
    if number := find_invoice_number(text):
        values["invoice_number"] = number
    if invoice_date := _find_date(text):
        values["invoice_date"] = invoice_date
    if currency := _find_currency(text):
        values["currency"] = currency
    values.update(_find_amounts(text))
    return RuleResult(values=values)


# ---- spreadsheets ---------------------------------------------------------------------------

_SYNONYMS: dict[str, tuple[str, ...]] = {
    "invoice_number": (
        "invoice no",
        "invoice number",
        "invoice",
        "inv no",
        "inv number",
        "inv",
        "bill no",
        "bill number",
        "document no",
        "doc no",
        "invoice id",
        "reference no",
    ),
    "invoice_date": (
        "date",
        "invoice date",
        "inv date",
        "bill date",
        "issue date",
        "date of issue",
        "document date",
    ),
    "supplier_name": (
        "supplier",
        "supplier name",
        "vendor",
        "vendor name",
        "seller",
        "issued by",
        "company",
    ),
    "customer_name": (
        "customer",
        "customer name",
        "client",
        "buyer",
        "bill to",
        "billed to",
        "sold to",
    ),
    "currency": ("currency", "curr", "ccy"),
    "subtotal": (
        "subtotal",
        "sub total",
        "net",
        "net amount",
        "net total",
        "amount before tax",
        "taxable value",
    ),
    "tax": ("tax", "vat", "gst", "tax amount", "vat amount", "sales tax"),
    "total": (
        "total",
        "grand total",
        "invoice total",
        "total amount",
        "amount due",
        "total due",
        "gross",
        "gross amount",
        "total incl tax",
        "amount payable",
    ),
    "amount": ("amount",),  # invoice total or line amount, decided per sheet
    "description": ("description", "item", "item description", "particulars", "product"),
    "quantity": ("qty", "quantity", "units"),
    "unit_price": ("unit price", "price", "rate", "unit cost"),
    "line_amount": ("line total", "line amount", "item total"),
}
_HEADER_TO_FIELD = {syn: f for f, syns in _SYNONYMS.items() for syn in syns}


def _norm_header(header: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", header.casefold()).split())


def map_columns(header: list[str]) -> dict[str, int]:
    """Field name -> column index, by the synonym table. The first column per field wins."""
    mapped: dict[str, int] = {}
    for index, name in enumerate(header):
        fld = _HEADER_TO_FIELD.get(_norm_header(name))
        if fld and fld not in mapped:
            mapped[fld] = index
    if "amount" in mapped:  # one "Amount" column: a line amount if lines exist, else the total
        amount = mapped.pop("amount")
        if "total" in mapped or "description" in mapped:
            mapped.setdefault("line_amount", amount)
        else:
            mapped["total"] = amount
    return mapped


def _cell(row: list[str], index: int | None) -> str:
    return row[index].strip() if index is not None and index < len(row) else ""


def extract_table(header: list[str], rows: list[list[str]]) -> RuleResult:
    """Map one invoice's spreadsheet rows to fields. Missing cells stay missing."""
    columns = map_columns(header)
    values: dict[str, Any] = {}
    for fld in ("invoice_number", "supplier_name", "customer_name"):
        if text := next((c for r in rows if (c := _cell(r, columns.get(fld)))), ""):
            values[fld] = " ".join(text.split())
    text = next((c for r in rows if (c := _cell(r, columns.get("currency")))), "")
    if re.fullmatch(r"[A-Za-z]{3}", text):
        values["currency"] = text.upper()
    for r in rows:
        if parsed := parse_date_prefix(_cell(r, columns.get("invoice_date"))):
            values["invoice_date"] = parsed
            break
    for fld in ("subtotal", "tax", "total"):
        for r in rows:
            amount = parse_amount(_cell(r, columns.get(fld)))
            if amount is not None:
                values[fld] = amount
                break
    items: list[dict[str, Any]] = []
    for r in rows:
        item: dict[str, Any] = {}
        if description := _cell(r, columns.get("description")):
            item["description"] = description
        for src, dst in (
            ("quantity", "quantity"),
            ("unit_price", "unit_price"),
            ("line_amount", "amount"),
        ):
            if (n := parse_amount(_cell(r, columns.get(src)))) is not None:
                item[dst] = n
        if item:
            items.append(item)
    complete = "invoice_number" in columns and "total" in columns
    return RuleResult(values, items, TABLE_CONFIDENCE, complete)
