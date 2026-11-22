import numpy as np
import pymupdf
import pytest

from app.core.errors import PermanentError
from app.pipeline import pdf


def test_digital_pdf_text_is_read_page_by_page(fixtures_dir):
    doc = pdf.open_pdf(fixtures_dir / "digital.pdf", max_pages=2000)
    try:
        texts = [pdf.page_text(page) for page in doc]
    finally:
        doc.close()
    assert len(texts) == 2
    assert "INV-1001" in texts[0] and "INV-2002" in texts[1]
    assert not any(pdf.is_scanned(t) for t in texts)


def test_page_under_50_non_space_chars_counts_as_scanned():
    assert pdf.is_scanned("x" * 49 + "   \n  ")
    assert not pdf.is_scanned("x" * 50)
    assert pdf.is_scanned("")


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("encrypted.pdf", "password protected"),
        ("corrupt.pdf", "no readable pages"),
        ("empty.pdf", "empty"),
    ],
)
def test_unreadable_pdfs_raise_permanent_error_with_plain_reason(fixtures_dir, name, message):
    with pytest.raises(PermanentError, match=message):
        pdf.open_pdf(fixtures_dir / name, max_pages=2000)


def test_page_cap_is_a_permanent_error(fixtures_dir):
    with pytest.raises(PermanentError, match="limit is 1"):
        pdf.open_pdf(fixtures_dir / "digital.pdf", max_pages=1)


def test_default_page_cap_does_not_block_thousand_page_pdfs(settings):
    assert settings.ledquill_max_pdf_pages >= 1000


def test_render_page_is_grayscale_300_dpi(fixtures_dir):
    doc = pdf.open_pdf(fixtures_dir / "digital.pdf", max_pages=2000)
    try:
        image = pdf.render_page(doc[0], max_pixels=50_000_000)
    finally:
        doc.close()
    assert image.dtype == np.uint8 and image.ndim == 2
    assert abs(image.shape[0] - 3508) <= 2 and abs(image.shape[1] - 2480) <= 2  # A4, 300 DPI


def test_render_respects_the_pixel_cap(tmp_path):
    big = pymupdf.open()
    big.new_page(width=3000, height=3000)  # 3000pt square = 12.5k px per side at 300 DPI
    path = tmp_path / "big.pdf"
    big.save(path)
    doc = pdf.open_pdf(path, max_pages=10)
    try:
        image = pdf.render_page(doc[0], max_pixels=4_000_000)
    finally:
        doc.close()
    assert image.shape[0] * image.shape[1] <= 4_000_000 * 1.01
