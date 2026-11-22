import numpy as np
import pymupdf
import pytest
from PIL import Image

from app.core.errors import PermanentError
from app.pipeline import ocr
from app.pipeline.extract import Limits, extract

LIMITS = Limits(max_pdf_pages=2000, max_tiff_frames=200, max_image_pixels=50_000_000)


def gray(path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"))


def rotated(path, degrees: float) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L").rotate(degrees, fillcolor=255))


@pytest.mark.parametrize("degrees", [3, -3])
def test_deskew_removes_a_three_degree_rotation_in_either_direction(fixtures_dir, degrees):
    page = rotated(fixtures_dir / "scanned.png", degrees)
    assert abs(abs(ocr.estimate_skew(page)) - 3) < 0.5
    assert abs(ocr.estimate_skew(ocr.deskew(page))) < 0.5


def test_deskew_leaves_a_straight_page_untouched(fixtures_dir):
    page = gray(fixtures_dir / "scanned.png")
    assert ocr.deskew(page) is page


def test_preprocess_returns_a_binary_image(fixtures_dir):
    out = ocr.preprocess(gray(fixtures_dir / "scanned.png"))
    assert set(np.unique(out)) <= {0, 255}


def test_clean_scan_is_read_with_high_confidence(fixtures_dir):
    result = ocr.ocr_image(gray(fixtures_dir / "scanned.png"))
    assert "INV-1001" in result.text and "1250.00" in result.text
    assert result.confidence >= 80


def test_rotated_noisy_jpeg_still_yields_the_invoice_number(fixtures_dir):
    result = ocr.ocr_image(gray(fixtures_dir / "rotated_noisy.jpg"))
    assert "INV-1001" in result.text
    assert result.confidence >= 60


def test_low_confidence_triggers_the_psm4_second_pass(monkeypatch):
    calls = []

    def fake(image, psm):
        calls.append(psm)
        return ocr.OcrResult("six", 40.0) if psm == 6 else ocr.OcrResult("four", 70.0)

    monkeypatch.setattr(ocr, "_run_tesseract", fake)
    result = ocr.ocr_image(np.full((50, 50), 255, np.uint8))
    assert calls == [6, 4] and result.text == "four"


def test_confident_page_does_not_run_the_second_pass(monkeypatch):
    calls = []
    monkeypatch.setattr(
        ocr, "_run_tesseract", lambda image, psm: calls.append(psm) or ocr.OcrResult("ok", 90.0)
    )
    ocr.ocr_image(np.full((50, 50), 255, np.uint8))
    assert calls == [6]


def test_blank_page_has_zero_confidence_and_no_text():
    result = ocr.ocr_image(np.full((300, 300), 255, np.uint8))
    assert result.text == "" and result.confidence == 0.0


def test_multiframe_tiff_yields_one_page_per_frame(fixtures_dir):
    extraction = extract(fixtures_dir / "multiframe.tif", "image", LIMITS)
    pages = list(extraction.pages)
    assert extraction.total == 2
    assert [p.page_no for p in pages] == [1, 2]
    assert "INV-1001" in pages[0].text and "INV-2002" in pages[1].text
    assert all(p.method == "ocr" and p.ocr_confidence > 60 for p in pages)


def test_scanned_pdf_page_is_ocrd_not_text_extracted(tmp_path, fixtures_dir):
    scanned = pymupdf.open()
    page = scanned.new_page(width=620, height=350)
    page.insert_image(page.rect, filename=str(fixtures_dir / "scanned.png"))
    path = tmp_path / "scanned.pdf"
    scanned.save(path)
    pages = list(extract(path, "pdf", LIMITS).pages)
    assert [p.method for p in pages] == ["ocr"]
    assert "INV-1001" in pages[0].text


def test_tiff_frame_cap_is_a_permanent_error(fixtures_dir):
    with pytest.raises(PermanentError, match="2 frames; the limit is 1"):
        extract(fixtures_dir / "multiframe.tif", "image", Limits(2000, 1, 50_000_000))


@pytest.mark.parametrize("cap", [1000, 800_000])  # beyond Pillow's 2x hard stop / just over 1x
def test_pixel_cap_is_a_permanent_error(fixtures_dir, cap):
    """The fixture is 1240x700 = 868,000 pixels."""
    with pytest.raises(PermanentError, match="too large"):
        list(extract(fixtures_dir / "scanned.png", "image", Limits(2000, 200, cap)).pages)


def test_corrupt_image_is_a_permanent_error(tmp_path):
    path = tmp_path / "bad.png"
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"not really a png")
    with pytest.raises(PermanentError, match="damaged"):
        list(extract(path, "image", LIMITS).pages)
