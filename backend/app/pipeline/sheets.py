"""Stage 2c: spreadsheets (XLSX, XLS, CSV). Every non-empty sheet becomes one page of text.

A sheet's text is its non-empty rows, cells joined by a tab, in sheet order (any title rows
above the header are kept). `detect_header_row` finds the header again from those rows, so
the later split and field stages can map columns without a second parse of the file.
"""

import csv
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from app.core.errors import PermanentError
from app.pipeline.detect import decode_text, sniff_delimiter

HEADER_MIN_TEXT_CELLS = 3
MAX_XLSX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024  # zip-bomb guard
_NUMBER_LIKE = re.compile(r"^[\s$€£¥+\-(]*\d[\d,.\s]*[)%]?$")
_DATE_LIKE = re.compile(r"^\d{4}-\d{2}-\d{2}([ T].*)?$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$")
_ENGINES = {"xlsx": "openpyxl", "xls": "xlrd"}


@dataclass(frozen=True)
class Sheet:
    index: int  # 1-based position in the workbook (1 for CSV)
    name: str
    text: str
    row_count: int
    header_row: int | None  # index into the sheet's non-empty rows, None if not found


def _cell_text(value: object) -> str:
    if value is None or (isinstance(value, float) and value != value):  # NaN
        return ""
    if isinstance(value, pd.Timestamp | datetime):
        return value.date().isoformat() if value.time() == datetime.min.time() else str(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _is_text_cell(cell: str) -> bool:
    return bool(cell) and not _NUMBER_LIKE.match(cell) and not _DATE_LIKE.match(cell)


def detect_header_row(rows: list[list[str]]) -> int | None:
    """First row with at least three non-empty text (non-numeric, non-date) cells."""
    for i, row in enumerate(rows):
        if sum(_is_text_cell(c) for c in row) >= HEADER_MIN_TEXT_CELLS:
            return i
    return None


def _clean_rows(raw_rows: list[list[object]]) -> list[list[str]]:
    rows = []
    for raw in raw_rows:
        cells = [_cell_text(v) for v in raw]
        while cells and not cells[-1]:
            cells.pop()
        if cells:
            rows.append(cells)
    return rows


def _to_sheet(index: int, name: str, rows: list[list[str]]) -> Sheet | None:
    if not rows:
        return None
    text = "\n".join("\t".join(cells) for cells in rows)
    return Sheet(index, name, text, len(rows), detect_header_row(rows))


def read_sheets(path: Path, file_type: str) -> list[Sheet]:
    """Parse every sheet. Raises PermanentError for unreadable, encrypted or empty files."""
    sheets = _read_csv(path) if file_type == "csv" else _read_workbook(path, file_type)
    if not sheets:
        raise PermanentError("This spreadsheet contains no data.")
    return sheets


def _read_csv(path: Path) -> list[Sheet]:
    decoded = decode_text(path.read_bytes())
    if decoded is None:
        raise PermanentError("This CSV file uses an unsupported text encoding.")
    text, _encoding = decoded
    try:
        raw = list(csv.reader(io.StringIO(text), delimiter=sniff_delimiter(text)))
    except csv.Error as exc:
        raise PermanentError("This CSV file is malformed and cannot be read.") from exc
    sheet = _to_sheet(1, "csv", _clean_rows(raw))
    return [sheet] if sheet else []


def _read_workbook(path: Path, file_type: str) -> list[Sheet]:
    if file_type == "xlsx":
        _guard_zip_bomb(path)
    try:
        frames = pd.read_excel(
            path, sheet_name=None, header=None, dtype=object, engine=_ENGINES[file_type]
        )
    except Exception as exc:  # parsers raise many unrelated types on bad input
        if "encrypt" in str(exc).lower() or "password" in str(exc).lower():
            raise PermanentError("This spreadsheet is password protected.") from exc
        raise PermanentError("This spreadsheet is damaged and cannot be read.") from exc
    sheets = []
    for position, (name, frame) in enumerate(frames.items(), start=1):
        sheet = _to_sheet(position, str(name), _clean_rows(frame.values.tolist()))
        if sheet:
            sheets.append(sheet)
    return sheets


def _guard_zip_bomb(path: Path) -> None:
    try:
        with zipfile.ZipFile(path) as archive:
            total = sum(info.file_size for info in archive.infolist())
    except zipfile.BadZipFile as exc:
        raise PermanentError("This spreadsheet is damaged and cannot be read.") from exc
    if total > MAX_XLSX_UNCOMPRESSED_BYTES:
        raise PermanentError("This spreadsheet is too large once unpacked.")
