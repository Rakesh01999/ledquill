"""Stage 1: decide the real file type from content, never from name or client MIME.

One function, `detect(head)`, serves both the upload endpoint and the worker's detect
stage, so the two cannot disagree.
"""

import codecs
import csv
from dataclasses import dataclass

import filetype

from app.core.errors import PermanentError

HEAD_BYTES = 64 * 1024  # enough for magic bytes and a CSV sniff

_MAGIC_TYPES = {
    "application/pdf": ("pdf", "pdf"),
    "image/jpeg": ("image", "jpg"),
    "image/png": ("image", "png"),
    "image/tiff": ("image", "tiff"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ("xlsx", "xlsx"),
    "application/vnd.ms-excel": ("xls", "xls"),
}
_CSV_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252")
_CSV_DELIMITERS = ",;\t|"
UNSUPPORTED_MESSAGE = "Unsupported file type. Accepted: PDF, JPG, PNG, TIFF, XLSX, XLS and CSV."


class UnsupportedFileError(PermanentError):
    """The content is not one of the accepted types."""


class EmptyFileError(PermanentError):
    """The file has no bytes."""


@dataclass(frozen=True)
class Detected:
    file_type: str  # pdf | image | xlsx | xls | csv
    mime_type: str
    extension: str


def detect(head: bytes) -> Detected:
    """Classify a file from its first bytes. Raises EmptyFileError / UnsupportedFileError."""
    if not head:
        raise EmptyFileError("The file is empty.")
    kind = filetype.guess(head)
    if kind is not None and kind.mime in _MAGIC_TYPES:
        file_type, ext = _MAGIC_TYPES[kind.mime]
        return Detected(file_type, kind.mime, ext)
    if kind is None and _looks_like_csv(head):
        return Detected("csv", "text/csv", "csv")
    raise UnsupportedFileError(UNSUPPORTED_MESSAGE)


def decode_text(data: bytes, *, partial: bool = False) -> tuple[str, str] | None:
    """Decode text with the first working CSV encoding. `partial` tolerates a multi-byte
    character cut off at the end of a head sample. Returns (text, encoding) or None."""
    for encoding in _CSV_ENCODINGS:
        decoder = codecs.getincrementaldecoder(encoding)("strict")
        try:
            return decoder.decode(data, final=not partial), encoding
        except UnicodeDecodeError:
            continue
    return None


def sniff_delimiter(text: str) -> str:
    try:
        return csv.Sniffer().sniff(text[:16384], delimiters=_CSV_DELIMITERS).delimiter
    except csv.Error:
        return ","


def _looks_like_csv(head: bytes) -> bool:
    """Printable text whose first lines share one delimiter and a consistent column count."""
    if b"\x00" in head:
        return False
    decoded = decode_text(head, partial=True)
    if decoded is None:
        return False
    text = decoded[0]
    if sum(ch.isprintable() or ch in "\r\n\t" for ch in text) < 0.98 * len(text):
        return False
    lines = [ln for ln in text.splitlines() if ln.strip()][:20]
    if len(lines) < 2:
        return False
    try:
        delimiter = csv.Sniffer().sniff("\n".join(lines), delimiters=_CSV_DELIMITERS).delimiter
    except csv.Error:
        return False
    counts = [len(row) for row in csv.reader(lines, delimiter=delimiter)]
    # the last line of a truncated head may be cut mid-row, so ignore it when sampling
    sample = counts[:-1] if len(head) >= HEAD_BYTES and len(counts) > 2 else counts
    return max(sample) >= 2 and sample.count(max(sample)) >= max(2, len(sample) // 2)
