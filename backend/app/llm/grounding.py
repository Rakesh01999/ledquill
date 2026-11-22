"""The anti-hallucination guard, in code: a value the model returned that is not printed in the
source text becomes null with confidence 0. `raw_extraction` keeps what the model said.

Known limits: a number counts as printed if it appears anywhere in the text, so a wrong value
that happens to be printed elsewhere (a quantity equal to the total) still passes; the rules
and V-04/V-05 are what catch that. A day/month pair printed as 03/04/2026 grounds either order.
"""

import calendar
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from rapidfuzz import fuzz

from app.pipeline.numbers import MAX_ABS, source_numbers
from app.schemas.extraction import (
    FIELDS,
    Confidence,
    ExtractionResult,
    LineItemData,
)

NAME_RATIO = 90
_SYMBOL_CURRENCIES = {
    "$": {"USD"},
    "€": {"EUR"},
    "£": {"GBP"},
    "৳": {"BDT"},
    "₹": {"INR"},
    "¥": {"JPY", "CNY"},
}
_ORDINAL = re.compile(r"(?<=\d)(?:st|nd|rd|th)\b")
_MONTH_NAMES = [m.lower() for m in calendar.month_name[1:]]
_MONTH_ABBR = [m.lower() for m in calendar.month_abbr[1:]]


def _squash(text: str) -> str:
    return " ".join(text.casefold().split())


def _alnum(text: str) -> str:
    return re.sub(r"[\W_]+", "", text.casefold())


def date_forms(d: date) -> set[str]:
    """Common printed forms of a date, for substring search in lowercased, squashed text."""
    forms: set[str] = set()
    y4, y2 = f"{d.year}", f"{d.year % 100:02d}"
    for sep in ("/", "-", "."):
        for a, b in ((d.day, d.month), (d.month, d.day)):
            for pad in (True, False):
                x, y = (f"{a:02d}", f"{b:02d}") if pad else (str(a), str(b))
                forms.add(f"{x}{sep}{y}{sep}{y4}")
                forms.add(f"{x}{sep}{y}{sep}{y2}")
        forms.add(f"{y4}{sep}{d.month:02d}{sep}{d.day:02d}")
        forms.add(f"{y4}{sep}{d.month}{sep}{d.day}")
    month_full, month_abbr = _MONTH_NAMES[d.month - 1], _MONTH_ABBR[d.month - 1]
    for month in {month_full, month_abbr, "sept" if d.month == 9 else month_abbr}:
        for day in (str(d.day), f"{d.day:02d}"):
            for year in (y4, y2):
                forms.update(
                    {
                        f"{day} {month} {year}",
                        f"{day} {month}, {year}",
                        f"{day}-{month}-{year}",
                        f"{month} {day}, {year}",
                        f"{month} {day} {year}",
                        f"{month}. {day}, {year}",
                        f"{day} {month}. {year}",
                    }
                )
    return forms


def _date_grounded(value: date, source: str) -> bool:
    haystack = _ORDINAL.sub("", _squash(source))
    return any(form in haystack for form in date_forms(value))


def _name_grounded(value: str, source: str) -> bool:
    needle, haystack = _squash(value), _squash(source)
    if needle in haystack:
        return True
    return fuzz.partial_ratio(needle, haystack) >= NAME_RATIO


def _number_grounded(value: Decimal, printed: set[Decimal]) -> bool:
    return abs(value) < MAX_ABS and abs(value) in printed


def _currency_grounded(code: str, source: str) -> bool:
    if re.search(rf"\b{re.escape(code)}\b", source, re.IGNORECASE):
        return True
    return any(sym in source and code in codes for sym, codes in _SYMBOL_CURRENCIES.items())


@dataclass
class GroundingReport:
    result: ExtractionResult
    nulled: list[str]  # fields (and line item parts) whose values were not found


def ground(result: ExtractionResult, source: str) -> GroundingReport:
    """Return a copy of `result` where every value not found in `source` is null."""
    printed = source_numbers(source)
    nulled: list[str] = []
    values: dict[str, Any] = {}
    conf = result.confidence_map()

    for name in FIELDS:
        value = getattr(result, name)
        ok = value is not None
        if ok:
            if name == "invoice_number":
                ok = _alnum(value) in _alnum(source)  # exact, ignoring case and punctuation
            elif name in ("supplier_name", "customer_name"):
                ok = _name_grounded(value, source)
            elif name == "invoice_date":
                ok = _date_grounded(value, source)
            elif name == "currency":
                ok = _currency_grounded(value, source)
            else:
                ok = _number_grounded(value, printed)
            if not ok:
                nulled.append(name)
        values[name] = value if ok else None
        conf[name] = conf[name] if ok else 0.0

    items: list[LineItemData] = []
    for n, item in enumerate(result.line_items, 1):
        kept: dict[str, Any] = {}
        for part in ("quantity", "unit_price", "amount"):
            value = getattr(item, part)
            if value is None:
                kept[part] = None
            elif _number_grounded(value, printed):
                kept[part] = value
            else:
                kept[part] = None
                nulled.append(f"line_items[{n}].{part}")
        description = item.description
        if description is not None and not _name_grounded(description, source):
            description = None
            nulled.append(f"line_items[{n}].description")
        if description is not None or any(v is not None for v in kept.values()):
            items.append(LineItemData(description=description, **kept))

    grounded = ExtractionResult(**values, line_items=items, confidence=Confidence(**conf))
    return GroundingReport(grounded, nulled)


def _same(name: str, a: Any, b: Any) -> bool:
    if isinstance(a, str) and isinstance(b, str):
        return _alnum(a) == _alnum(b)
    return a == b


def reconcile(
    rule_values: dict[str, Any],
    rule_items: list[dict[str, Any]],
    rule_confidence: float,
    grounded: ExtractionResult | None,
) -> tuple[ExtractionResult, str]:
    """Merge rule values with the grounded LLM result. Returns (result, method).

    Both present and equal: keep it, with the higher confidence. Both present and different:
    prefer the LLM value, cap confidence at 0.6, and let V-08 flag it. Only one grounded
    value: use it. A rule value is read straight from the text, so it is grounded already.
    """
    values: dict[str, Any] = {}
    conf: dict[str, float] = {}
    used_rule = False
    llm_conf = grounded.confidence_map() if grounded else {}
    for name in FIELDS:
        rule = rule_values.get(name)
        llm = getattr(grounded, name) if grounded else None
        if llm is not None and rule is not None:
            used_rule = True
            values[name] = llm
            if _same(name, llm, rule):
                conf[name] = max(llm_conf[name], rule_confidence)
            else:
                conf[name] = min(llm_conf[name], 0.6)
        elif llm is not None:
            values[name], conf[name] = llm, llm_conf[name]
        elif rule is not None:
            used_rule = True
            values[name], conf[name] = rule, rule_confidence
        else:
            values[name], conf[name] = None, 0.0

    if grounded is not None and grounded.line_items:
        items = list(grounded.line_items)
    else:
        items = [LineItemData(**i) for i in rule_items]
    result = ExtractionResult(**values, line_items=items, confidence=Confidence(**conf))
    method = "rules" if grounded is None else ("rules+llm" if used_rule else "llm")
    return result, method
