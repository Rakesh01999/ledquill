"""Number parsing shared by the rules and the grounding check. Decimal only, never float."""

import re
from decimal import Decimal, InvalidOperation

# "1,250.00", "1.250,00", "1 250,00", "1250", "12.5": a run of 3-digit groups joined by one
# separator with an optional decimal part, otherwise a plain number.
NUMBER_TOKEN = re.compile(r"\d{1,3}(?:[  ,.']\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d+)?")
MAX_ABS = Decimal(10) ** 12  # numeric(14,2) holds less than this


def amount_candidates(token: str) -> list[Decimal]:
    """Every sensible reading of a printed number. Ambiguous "1,250" gives 1250 and 1.25."""
    core = token.strip().replace(" ", "").replace(" ", "").replace("'", "")
    has_comma, has_dot = "," in core, "." in core
    texts: list[str] = []
    if has_comma and has_dot:
        decimal_sep = "," if core.rfind(",") > core.rfind(".") else "."
        thousands = "." if decimal_sep == "," else ","
        texts.append(core.replace(thousands, "").replace(decimal_sep, "."))
    elif has_comma or has_dot:
        sep = "," if has_comma else "."
        parts = core.split(sep)
        if len(parts) > 2:
            if all(len(p) == 3 for p in parts[1:]):
                texts.append("".join(parts))
        else:
            head, tail = parts
            if len(tail) == 3 and 1 <= len(head) <= 3:
                texts += [head + tail, f"{head}.{tail}"]  # thousands first: money is likelier
            else:
                texts.append(f"{head}.{tail}")
    else:
        texts.append(core)
    out: list[Decimal] = []
    for text in texts:
        try:
            value = Decimal(text)
        except InvalidOperation:
            continue
        if value.is_finite() and abs(value) < MAX_ABS and value not in out:
            out.append(value)
    return out


def parse_amount(text: str) -> Decimal | None:
    """The most likely single reading of a printed amount (leading '-' or '(' = negative)."""
    match = NUMBER_TOKEN.search(text.replace(" ", " "))
    if not match:
        return None
    candidates = amount_candidates(match.group(0))
    if not candidates:
        return None
    negative = text.strip().startswith(("-", "("))
    return -candidates[0] if negative else candidates[0]


def source_numbers(text: str) -> set[Decimal]:
    """Every number printed in `text`, for the grounding check.

    Digits glued to letters or '#', or inside ids and dates (INV-1001, 2026-03-14), are not
    counted: they are identifiers, not amounts.
    """
    found: set[Decimal] = set()
    for match in NUMBER_TOKEN.finditer(text):
        start, end = match.span()
        before = text[start - 1] if start else ""
        before2 = text[start - 2] if start > 1 else ""
        after, after2 = text[end : end + 1], text[end + 1 : end + 2]
        if before.isalpha() or before in ("#", "/"):
            continue
        if before == "-" and before2.isalnum():
            continue
        if after in ("-", "/") and after2.isdigit():
            continue
        token = match.group(0)
        found.update(amount_candidates(token))
        if " " in token or " " in token:  # "10 100.00" may be two numbers
            for part in re.split(r"[  ]+", token):
                found.update(amount_candidates(part))
    return found
