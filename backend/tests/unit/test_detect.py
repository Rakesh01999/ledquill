import pytest

from app.pipeline.detect import (
    HEAD_BYTES,
    EmptyFileError,
    UnsupportedFileError,
    decode_text,
    detect,
)
from tests.fixtures.generate import make_disguises


def head(path):
    return path.read_bytes()[:HEAD_BYTES]


@pytest.mark.parametrize(
    ("name", "file_type", "mime"),
    [
        ("digital.pdf", "pdf", "application/pdf"),
        ("scanned.png", "image", "image/png"),
        ("rotated_noisy.jpg", "image", "image/jpeg"),
        ("multiframe.tif", "image", "image/tiff"),
        (
            "two_sheets.xlsx",
            "xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        ("legacy.xls", "xls", "application/vnd.ms-excel"),
        ("cp1252.csv", "csv", "text/csv"),
    ],
)
def test_each_supported_type_is_detected_by_content(fixtures_dir, name, file_type, mime):
    detected = detect(head(fixtures_dir / name))
    assert (detected.file_type, detected.mime_type) == (file_type, mime)


def test_empty_content_is_rejected():
    with pytest.raises(EmptyFileError):
        detect(b"")


@pytest.mark.parametrize("key", ["docx_as_xlsx", "zip_as_xlsx", "text_as_pdf"])
def test_disguised_files_are_rejected_whatever_the_name_says(tmp_path, key):
    path = make_disguises(tmp_path)[key]
    with pytest.raises(UnsupportedFileError):
        detect(head(path))


def test_pdf_renamed_jpg_is_classified_by_content_as_pdf(tmp_path):
    path = make_disguises(tmp_path)["pdf_as_jpg"]
    assert path.suffix == ".jpg"
    assert detect(head(path)).file_type == "pdf"


@pytest.mark.parametrize(
    "payload",
    [b"MZ\x90\x00\x03\x00\x00\x00", b"\x00\x01\x02\x03" * 50, b"just one line, no table"],
)
def test_executables_binary_and_prose_are_rejected(payload):
    with pytest.raises(UnsupportedFileError):
        detect(payload)


def test_csv_with_semicolons_and_utf8_is_accepted():
    assert detect(b"a;b;c\n1;2;3\n").file_type == "csv"


def test_decode_text_falls_back_to_cp1252():
    assert decode_text("Müller €".encode("cp1252")) == ("Müller €", "cp1252")


def test_decode_text_tolerates_a_multibyte_character_cut_at_the_end():
    cut = "Müller".encode()[:2]  # b"M\xc3": the "ü" is split
    assert decode_text(cut, partial=True) == ("M", "utf-8-sig")
    assert decode_text(cut, partial=False)[1] == "cp1252"
