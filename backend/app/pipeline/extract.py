"""Stage 2: turn a stored file into per-page text. Pure with respect to the database:
it yields `PageResult`s one at a time and the worker decides how to persist them."""

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from app.core.errors import PermanentError
from app.core.text import clean_text
from app.pipeline import ocr, pdf, sheets


@dataclass(frozen=True)
class PageResult:
    page_no: int
    method: str  # text | ocr | sheet
    text: str
    ocr_confidence: float | None = None

    def __post_init__(self) -> None:
        # The one place PDF text, OCR text and spreadsheet cells all pass through: whatever
        # PostgreSQL cannot store is removed here, so nothing downstream has to think about it.
        object.__setattr__(self, "text", clean_text(self.text))


@dataclass(frozen=True)
class Limits:
    max_pdf_pages: int
    max_tiff_frames: int
    max_image_pixels: int


@dataclass
class Extraction:
    total: int
    pages: Iterator[PageResult]


def extract(path: Path, file_type: str, limits: Limits) -> Extraction:
    """Validate the file now (errors raise here) and return a lazy page iterator."""
    if file_type == "pdf":
        return _extract_pdf(path, limits)
    if file_type == "image":
        return _extract_image(path, limits)
    if file_type in ("xlsx", "xls", "csv"):
        return _extract_sheets(path, file_type)
    raise PermanentError("This file type cannot be processed.")


def _extract_pdf(path: Path, limits: Limits) -> Extraction:
    doc = pdf.open_pdf(path, limits.max_pdf_pages)

    def pages() -> Iterator[PageResult]:
        try:
            for page in doc:  # one page object at a time
                text = pdf.page_text(page)
                if not pdf.is_scanned(text):
                    yield PageResult(page.number + 1, "text", text)
                    continue
                result = ocr.ocr_image(pdf.render_page(page, limits.max_image_pixels))
                yield PageResult(page.number + 1, "ocr", result.text, result.confidence)
        finally:
            doc.close()

    return Extraction(total=doc.page_count, pages=pages())


def _extract_image(path: Path, limits: Limits) -> Extraction:
    img = ocr.open_image(path, limits.max_tiff_frames, limits.max_image_pixels)
    total = getattr(img, "n_frames", 1)

    def pages() -> Iterator[PageResult]:
        for number, gray in enumerate(ocr.iter_gray_frames(img, limits.max_image_pixels), 1):
            result = ocr.ocr_image(gray)
            yield PageResult(number, "ocr", result.text, result.confidence)

    return Extraction(total=total, pages=pages())


def _extract_sheets(path: Path, file_type: str) -> Extraction:
    parsed = sheets.read_sheets(path, file_type)
    return Extraction(
        total=len(parsed),
        pages=iter(PageResult(s.index, "sheet", s.text) for s in parsed),
    )
