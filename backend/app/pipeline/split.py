"""Stage 3: group pages (or spreadsheet rows) into invoices. Pure functions, no I/O.

A page starts a new invoice when it prints an invoice number that differs from the current
invoice's number. Pages without a number, or repeating the same number, join the current
invoice. Spreadsheet rows are grouped by invoice number, one group per invoice.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.pipeline.rules import find_invoice_number, map_columns
from app.pipeline.sheets import detect_header_row


@dataclass(frozen=True)
class PageText:
    page_no: int
    method: str  # text | ocr | sheet
    text: str


@dataclass(frozen=True)
class Table:
    header: list[str]
    rows: list[list[str]]


@dataclass
class Segment:
    page_numbers: list[int]
    text: str
    table: Table | None = None


def _key(number: str) -> str:
    return "".join(number.split()).casefold()


def split_pdf_pages(pages: Sequence[PageText]) -> list[Segment]:
    groups: list[tuple[str | None, list[PageText]]] = []
    for page in pages:
        number = find_invoice_number(page.text)
        key = _key(number) if number else None
        if not groups or (key is not None and key != groups[-1][0] and groups[-1][0] is not None):
            groups.append((key, [page]))
            continue
        current_key, members = groups[-1]
        members.append(page)
        if current_key is None:
            groups[-1] = (key, members)  # leading pages without a number adopt the first one
    return [
        Segment([p.page_no for p in members], "\n\n".join(p.text for p in members))
        for _, members in groups
    ]


def split_sheet(page: PageText) -> list[Segment]:
    rows = [line.split("\t") for line in page.text.split("\n")]
    header_at = detect_header_row(rows)
    if header_at is None or header_at + 1 >= len(rows):
        return [Segment([page.page_no], page.text)]  # no table: the whole sheet is one invoice
    preamble, header, data = rows[:header_at], rows[header_at], rows[header_at + 1 :]
    number_col = map_columns(header).get("invoice_number")
    groups: dict[str, list[list[str]]] = {}
    last: str | None = None
    for n, row in enumerate(data):
        number = row[number_col].strip() if number_col is not None and number_col < len(row) else ""
        if number_col is None:
            key = f"row-{n}"  # no invoice-number column: each row is its own invoice
        elif number:
            key = _key(number)
        elif last is not None:
            key = last  # blank number: a continuation row of the previous invoice
        else:
            key = f"row-{n}"
        groups.setdefault(key, []).append(row)
        last = key
    lead = ["\t".join(r) for r in preamble]
    return [
        Segment(
            [page.page_no],
            "\n".join([*lead, "\t".join(header), *("\t".join(r) for r in members)]),
            Table(header, members),
        )
        for members in groups.values()
    ]


def split_document(pages: Sequence[PageText]) -> list[Segment]:
    """Every page of one document, in page order, grouped into invoices."""
    if pages and all(p.method == "sheet" for p in pages):
        return [seg for page in pages for seg in split_sheet(page)]
    return split_pdf_pages(pages)
