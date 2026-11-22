"""Upload -> eager Celery worker -> invoices through the API, once per accepted file type.
The LLM is a FakeProvider; spreadsheets with mappable headers must not call it at all."""

import io
from decimal import Decimal as D

import pytest

from tests.conftest import API_HEADERS
from tests.fakes import llm_json
from tests.fixtures.builders import MISMATCH_LLM, mismatch_pdf

DOCS, INVOICES = "/api/v1/documents", "/api/v1/invoices"


def upload(client, name, data):
    r = client.post(DOCS, files=[("files", (name, io.BytesIO(data)))], headers=API_HEADERS)
    assert r.status_code == 202, r.text
    return r.json()["accepted"][0]["document_id"]


def invoices_for(client, document_id):
    r = client.get(INVOICES, params={"document_id": document_id}, headers=API_HEADERS)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def run(client, fixtures_dir, name):
    document_id = upload(client, name, (fixtures_dir / name).read_bytes())
    status = client.get(f"{DOCS}/{document_id}", headers=API_HEADERS).json()
    assert status["status"] == "completed", status
    return invoices_for(client, document_id)


def test_digital_pdf_two_pages_become_two_invoices(client, fake_llm, fixtures_dir):
    fake_llm.script(
        llm_json(invoice_number="INV-1001", supplier_name="Northwind Traders Ltd", total=1250.00),
        llm_json(invoice_number="INV-2002", supplier_name="Contoso Supplies", total=480.50),
    )
    first, second = run(client, fixtures_dir, "digital.pdf")
    assert (first["invoice_number"], first["total"], first["page_numbers"]) == (
        "INV-1001", "1250.00", [1],
    )  # fmt: skip
    assert (second["invoice_number"], second["currency"], second["page_numbers"]) == (
        "INV-2002", "EUR", [2],
    )  # fmt: skip
    assert first["method"] == "rules+llm" and first["model"] == "groq:model-groq"


def test_scanned_image_is_extracted_after_ocr(client, fake_llm, fixtures_dir):
    fake_llm.script(
        llm_json(invoice_number="INV-1001", supplier_name="Northwind Traders Ltd", total=1250.00)
    )
    (inv,) = run(client, fixtures_dir, "scanned.png")
    assert inv["invoice_number"] == "INV-1001" and inv["page_numbers"] == [1]
    assert inv["total"] in ("1250.00", None)  # OCR may misread; a value is never invented


def test_multiframe_tiff_is_split_per_frame(client, fake_llm, fixtures_dir):
    fake_llm.script(llm_json(invoice_number="INV-1001"), llm_json(invoice_number="INV-2002"))
    invoices = run(client, fixtures_dir, "multiframe.tif")
    assert [i["invoice_number"] for i in invoices] == ["INV-1001", "INV-2002"]


def test_xlsx_with_two_sheets_is_read_by_rules_without_the_llm(client, fake_llm, fixtures_dir):
    invoices = run(client, fixtures_dir, "two_sheets.xlsx")
    assert [i["invoice_number"] for i in invoices] == ["INV-1001", "INV-1002", "INV-2001"]
    assert invoices[1]["total"] == "99.50" and invoices[2]["supplier_name"] == "Fabrikam"
    assert {i["method"] for i in invoices} == {"rules"} and fake_llm.calls == []


def test_xls_is_read_by_rules_without_the_llm(client, fake_llm, fixtures_dir):
    (inv,) = run(client, fixtures_dir, "legacy.xls")
    assert (inv["invoice_number"], inv["supplier_name"], inv["total"]) == (
        "INV-3001", "Tailspin Toys", "310.25",
    )  # fmt: skip
    assert inv["invoice_date"] == "2026-05-01" and fake_llm.calls == []


def test_csv_with_unmapped_german_headers_goes_through_the_llm(client, fake_llm, fixtures_dir):
    fake_llm.script(
        llm_json(invoice_number="RE-1001", supplier_name="Müller GmbH", total=1250.00,
                 currency="EUR", invoice_date="2026-03-14"),
        llm_json(invoice_number="RE-1002", supplier_name="Café Société", total=99.50),
    )  # fmt: skip
    first, second = run(client, fixtures_dir, "cp1252.csv")
    assert (first["supplier_name"], first["total"], first["currency"]) == (
        "Müller GmbH", "1250.00", "EUR",
    )  # fmt: skip
    assert first["invoice_date"] == "2026-03-14" and second["supplier_name"] == "Café Société"
    assert len(fake_llm.calls) == 2


def test_pdf_with_a_total_mismatch_reports_the_issue_through_the_api(client, fake_llm, tmp_path):
    fake_llm.script(MISMATCH_LLM)
    document_id = upload(client, "m.pdf", mismatch_pdf(tmp_path / "m.pdf").read_bytes())
    (inv,) = invoices_for(client, document_id)
    assert inv["status"] == "needs_review"
    (v05,) = [i for i in inv["issues"] if i["rule_id"] == "V-05"]
    assert (v05["expected"], v05["actual"], v05["severity"]) == ("1,150.00", "1,200.00", "error")
    assert D(inv["total"]) == D("1200.00") and inv["line_items"][0]["description"] == "A4 paper"
    assert set(inv["confidence"]) >= {"invoice_number", "total"}


@pytest.mark.parametrize("name", ["corrupt.pdf", "encrypted.pdf"])
def test_unreadable_files_create_no_invoices(client, fixtures_dir, name):
    document_id = upload(client, name, (fixtures_dir / name).read_bytes())
    assert client.get(f"{DOCS}/{document_id}", headers=API_HEADERS).json()["status"] == "failed"
    assert invoices_for(client, document_id) == []
