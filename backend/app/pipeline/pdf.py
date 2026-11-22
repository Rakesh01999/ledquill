"""Stage 2a: PDFs. PyMuPDF reads one page at a time; nothing holds all pages in memory."""

import math
from pathlib import Path

import numpy as np
import pymupdf

from app.core.errors import PermanentError

SCANNED_CHAR_THRESHOLD = 50  # fewer non-space characters than this = no usable text layer
OCR_DPI = 300


def open_pdf(path: Path, max_pages: int) -> pymupdf.Document:
    """Open and validate a PDF. Corrupt, encrypted, empty or oversized files raise
    PermanentError with a plain-language reason."""
    if path.stat().st_size == 0:
        raise PermanentError("The file is empty.")
    try:
        doc = pymupdf.open(path, filetype="pdf")
    except (pymupdf.FileDataError, RuntimeError, ValueError) as exc:
        raise PermanentError("This PDF is damaged and cannot be read.") from exc
    try:
        if doc.needs_pass:
            raise PermanentError("This PDF is password protected.")
        count = doc.page_count
        if count == 0:
            raise PermanentError("This PDF has no readable pages.")
        if count > max_pages:
            raise PermanentError(f"This PDF has {count} pages; the limit is {max_pages}.")
    except BaseException:
        doc.close()
        raise
    return doc


def page_text(page: pymupdf.Page) -> str:
    try:
        return page.get_text("text")
    except RuntimeError as exc:
        raise PermanentError(f"Page {page.number + 1} of this PDF cannot be read.") from exc


def is_scanned(text: str) -> bool:
    return sum(not ch.isspace() for ch in text) < SCANNED_CHAR_THRESHOLD


def render_page(page: pymupdf.Page, max_pixels: int, dpi: int = OCR_DPI) -> np.ndarray:
    """Render one page to a grayscale uint8 array, lowering the DPI only if the page
    would exceed the pixel cap (very large page sizes)."""
    scale = dpi / 72
    width, height = page.rect.width * scale, page.rect.height * scale
    if width * height > max_pixels:
        scale *= math.sqrt(max_pixels / (width * height))
    try:
        pix = page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY, alpha=False
        )
    except RuntimeError as exc:
        raise PermanentError(f"Page {page.number + 1} of this PDF cannot be rendered.") from exc
    rows = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)
    return rows[:, : pix.width].copy()
