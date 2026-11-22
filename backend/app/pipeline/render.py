"""Render one page of a stored PDF or image to PNG for the review screen's source panel."""

from pathlib import Path

import pymupdf

from app.core.errors import PermanentError

RENDER_DPI = 110
_FILETYPES = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/tiff": "tiff",
}


def can_render(mime_type: str) -> bool:
    return mime_type in _FILETYPES


def render_page_png(path: Path, mime_type: str, page_no: int) -> bytes:
    """PNG bytes of page `page_no` (1-based). PermanentError when the file cannot be opened or
    has no such page."""
    try:
        with pymupdf.open(stream=path.read_bytes(), filetype=_FILETYPES[mime_type]) as doc:
            if not 1 <= page_no <= doc.page_count:
                raise PermanentError(f"The file has no page {page_no}.")
            return doc[page_no - 1].get_pixmap(dpi=RENDER_DPI).tobytes("png")
    except (pymupdf.FileDataError, RuntimeError, ValueError) as exc:
        raise PermanentError("The page could not be rendered.") from exc
