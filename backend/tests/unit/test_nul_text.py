"""Extracted text may contain NUL (0x00), which PostgreSQL text columns cannot store.

psycopg 3 refuses to send it ("PostgreSQL text fields cannot contain NUL (0x00) bytes", a
DataError raised in the driver, so the server never logs anything). The extract stage then
ends in the catch-all handler and the document fails with "Unexpected error ...", also on
every reprocess, because the file always produces the same text.

These tests feed NUL through each extraction path (PDF text layer, OCR, spreadsheet cells)
and through the real stages, against the test database only, and check that a NUL in a model
answer is handled the same way.
"""

import json

import numpy as np
import pytest
from sqlalchemy import select

from app.core.text import clean_text
from app.db.models import Document, Invoice, LineItem, Page
from app.pipeline import ocr, pdf
from app.pipeline.extract import Limits, extract
from app.pipeline.ocr import OcrResult
from app.schemas.extraction import ExtractionResult
from app.workers.stages import run_job
from tests.fakes import llm_json
from tests.fixtures.builders import invoice_page, write_pdf
from tests.helpers import create_document

pytestmark = pytest.mark.usefixtures("db_clean")

LIMITS = Limits(max_pdf_pages=50, max_tiff_frames=20, max_image_pixels=50_000_000)


def pages_of(session, doc) -> list[Page]:
    session.expire_all()
    return list(
        session.scalars(select(Page).where(Page.document_id == doc.id).order_by(Page.page_no))
    )


def inject_nul_into_pdf_text(monkeypatch, old: str, new: str) -> None:
    """The text layer of a real PDF, with `old` replaced by `new` (which holds a NUL)."""
    original = pdf.page_text
    monkeypatch.setattr(pdf, "page_text", lambda page: original(page).replace(old, new))


def clean_invoice_pdf(tmp_path):
    page = invoice_page(
        "INV-8001", "2026-09-05", "Initech LLC", "Globex Corp",
        [("Consulting", "1", "100.00", "100.00")], "100.00", "15.00", "115.00",
    )  # fmt: skip
    return write_pdf(tmp_path / "inv.pdf", [page])


# --- each extraction path, end to end through the real stages ------------------------------


def test_pdf_text_with_nul_does_not_fail_the_extract_stage(db_session, fixtures_dir, monkeypatch):
    original = pdf.page_text
    monkeypatch.setattr(pdf, "page_text", lambda page: original(page) + "\nref\x00 4711")
    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")

    status = run_job(db_session, doc.id, job.id, final_attempt=False)

    db_session.expire_all()
    doc = db_session.get(Document, doc.id)
    assert (status, doc.error) == ("completed", None)
    pages = pages_of(db_session, doc)
    assert pages and all("\x00" not in (p.text or "") for p in pages)
    assert all((p.text or "").endswith("\nref 4711") for p in pages)  # only the NUL is gone


def test_ocr_text_with_nul_does_not_fail_the_extract_stage(db_session, fixtures_dir, monkeypatch):
    monkeypatch.setattr(pdf, "is_scanned", lambda text: True)
    monkeypatch.setattr(pdf, "render_page", lambda page, max_pixels: np.zeros((4, 4), np.uint8))
    monkeypatch.setattr(ocr, "ocr_image", lambda gray: OcrResult("Acme\x00 Ltd\nTotal 10.00", 91.0))
    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")

    status = run_job(db_session, doc.id, job.id, final_attempt=False)

    db_session.expire_all()
    assert (status, db_session.get(Document, doc.id).error) == ("completed", None)
    pages = pages_of(db_session, doc)
    assert [p.method for p in pages] == ["ocr", "ocr"]
    assert all(p.text == "Acme Ltd\nTotal 10.00" for p in pages)


def test_spreadsheet_cell_with_nul_does_not_fail_the_extract_stage(db_session, tmp_path):
    # The NUL sits after the 64 KB head that file detection looks at, as it would in a real export.
    rows = ["invoice_number,supplier,total"] + [
        f"INV-{n:04d},Initech LLC,100.00" for n in range(4000)
    ]
    rows[3500] = "INV-3500,AC\x00ME Ltd,100.00"
    path = tmp_path / "register.csv"
    path.write_bytes("\n".join(rows).encode())
    doc, job = create_document(db_session, path)
    assert doc.file_type == "csv"

    status = run_job(db_session, doc.id, job.id, final_attempt=False)

    db_session.expire_all()
    assert (status, db_session.get(Document, doc.id).error) == ("completed", None)
    (sheet,) = pages_of(db_session, doc)
    assert "\x00" not in sheet.text and "ACME Ltd" in sheet.text


# --- the pipeline output itself (no database) ---------------------------------------------


def test_extracted_pages_never_contain_nul(fixtures_dir, monkeypatch):
    original = pdf.page_text
    monkeypatch.setattr(pdf, "page_text", lambda page: original(page) + "\nA\x00B")
    extraction = extract(fixtures_dir / "digital.pdf", "pdf", LIMITS)
    texts = [p.text for p in extraction.pages]
    assert texts and all("\x00" not in t for t in texts)


def test_lone_surrogates_are_replaced_so_the_text_can_be_encoded(fixtures_dir, monkeypatch):
    # PostgreSQL stores UTF-8; a lone surrogate cannot be encoded (a different error, same cause).
    original = pdf.page_text
    monkeypatch.setattr(pdf, "page_text", lambda page: original(page) + "\nx\ud800y")
    extraction = extract(fixtures_dir / "digital.pdf", "pdf", LIMITS)
    for page in extraction.pages:
        page.text.encode("utf-8")  # must not raise
        assert page.text.endswith("\nx�y")


def test_text_without_nul_is_left_exactly_as_it_was(fixtures_dir, monkeypatch):
    # Tabs, form feeds, other control characters, accents and currency signs are valid in
    # PostgreSQL text and must survive untouched.
    sample = (
        "Caf\u00e9\tTotal \u20ac1,250.00\x0c\x1f "
        "Invoice INV-1001 for Northwind Traders Ltd, due in 30 days\r\n"
    )
    monkeypatch.setattr(pdf, "page_text", lambda page: sample)
    extraction = extract(fixtures_dir / "digital.pdf", "pdf", LIMITS)
    assert [p.text for p in extraction.pages] == [sample, sample]


# --- grounding: a value is still found in the text once the NUL is gone --------------------


def test_value_split_by_nul_in_the_source_is_still_grounded(
    db_session, fake_llm, tmp_path, monkeypatch
):
    path = clean_invoice_pdf(tmp_path)
    inject_nul_into_pdf_text(monkeypatch, "INV-8001", "INV-80\x0001")
    fake_llm.script(
        llm_json(
            invoice_number="INV-8001",
            invoice_date="2026-09-05",
            supplier_name="Initech LLC",
            customer_name="Globex Corp",
            currency="USD",
            subtotal=100,
            tax=15,
            total=115,
        )  # fmt: skip
    )
    doc, job = create_document(db_session, path)

    status = run_job(db_session, doc.id, job.id, final_attempt=False)

    db_session.expire_all()
    assert status == "completed"
    invoice = db_session.scalars(select(Invoice).where(Invoice.document_id == doc.id)).one()
    assert invoice.invoice_number == "INV-8001"  # grounded in the sanitized text, not nulled


# --- the sanitizer itself ----------------------------------------------------------------


def test_clean_text_removes_nul_and_replaces_surrogates_and_nothing_else():
    assert clean_text("a\x00b\x00") == "ab"
    assert clean_text("x\ud800y\udfffz") == "x�y�z"
    untouched = "Café\t€1,250.00\x0c\x1f ก \U0001f600\r\n"
    assert clean_text(untouched) == untouched


# --- model output: a NUL in an answer must not fail the job -------------------------------


def test_extraction_result_cleans_the_strings_a_model_returns():
    result = ExtractionResult.model_validate(
        {
            "invoice_number": "A\x00-1",
            "supplier_name": "Init\x00ech  LLC",
            "customer_name": "\x00",
            "line_items": [{"description": " Cons\x00ulting "}],
        }
    )
    assert result.invoice_number == "A-1"
    assert result.supplier_name == "Initech LLC"
    assert result.customer_name is None  # nothing left once the NUL is gone
    assert result.line_items[0].description == "Consulting"


def test_nul_in_a_model_answer_is_stored_without_it(db_session, fake_llm, tmp_path):
    fake_llm.script(
        llm_json(
            invoice_number="INV-8001",
            invoice_date="2026-09-05",
            supplier_name="Initech\x00 LLC",
            customer_name="Globex Corp",
            currency="USD",
            subtotal=100,
            tax=15,
            total=115,
            line_items=[
                {"description": "Consult\x00ing", "quantity": 1, "unit_price": 100, "amount": 100}
            ],
        )  # fmt: skip
    )
    doc, job = create_document(db_session, clean_invoice_pdf(tmp_path))

    status = run_job(db_session, doc.id, job.id, final_attempt=False)

    db_session.expire_all()
    assert (status, db_session.get(Document, doc.id).error) == ("completed", None)
    invoice = db_session.scalars(select(Invoice).where(Invoice.document_id == doc.id)).one()
    assert invoice.supplier_name == "Initech LLC"  # grounded in the page text once cleaned
    assert "\\u0000" not in json.dumps(invoice.raw_extraction)
    items = db_session.scalars(select(LineItem).where(LineItem.invoice_id == invoice.id)).all()
    assert all("\x00" not in (i.description or "") for i in items)
    assert "\x00" not in (invoice.search_text or "")
