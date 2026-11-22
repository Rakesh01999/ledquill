"""Failure scenarios through the real API and the eager worker. Corrupt, encrypted, disguised,
empty and oversized uploads are already covered in test_pipeline_by_file_type.py and
tests/api/test_documents.py; this file holds the end-to-end gaps."""

import pymupdf

from app.llm.base import RateLimited
from tests.conftest import API_HEADERS
from tests.fakes import llm_json
from tests.fixtures.builders import MISMATCH_LLM, injection_pdf, mismatch_pdf
from tests.integration.test_extraction_by_file_type import DOCS, invoices_for, upload


def document(client, document_id):
    r = client.get(f"{DOCS}/{document_id}", headers=API_HEADERS)
    assert r.status_code == 200, r.text
    return r.json()


def test_blank_page_pdf_is_scanned_so_it_becomes_a_review_invoice_not_a_quiet_drop(
    client, fake_llm, tmp_path
):
    blank = pymupdf.open()
    blank.new_page()
    path = tmp_path / "blank.pdf"
    blank.save(path)
    document_id = upload(client, "blank.pdf", path.read_bytes())
    doc = document(client, document_id)
    assert doc["status"] == "completed" and doc["invoice_count"] == 1 and doc["error"] is None
    (inv,) = invoices_for(client, document_id)
    assert inv["status"] == "needs_review" and fake_llm.calls == []  # nothing invented
    assert all(inv[f] is None for f in ("invoice_number", "supplier_name", "total"))
    assert any(i["rule_id"] == "V-08" and "scan" in i["message"] for i in inv["issues"])


def test_every_model_rate_limited_keeps_the_rule_results_and_says_why(client, fake_llm, tmp_path):
    fake_llm.default = RateLimited("429")  # every call to every model fails
    document_id = upload(client, "m.pdf", mismatch_pdf(tmp_path / "m.pdf").read_bytes())
    doc = document(client, document_id)
    assert doc["status"] == "completed" and doc["error"] is None  # degraded, not failed
    (inv,) = invoices_for(client, document_id)
    assert inv["invoice_number"] == "INV-5001" and inv["method"] == "rules"
    assert inv["model"] is None and inv["status"] == "needs_review"
    unavailable = [i for i in inv["issues"] if "unavailable" in i["message"]]
    assert len(unavailable) == 1 and unavailable[0]["rule_id"] == "V-08"


def test_a_model_that_recovers_after_a_rate_limit_gives_a_normal_result(client, fake_llm, tmp_path):
    fake_llm.script(RateLimited("429"), MISMATCH_LLM)
    document_id = upload(client, "m.pdf", mismatch_pdf(tmp_path / "m.pdf").read_bytes())
    assert document(client, document_id)["status"] == "completed"
    (inv,) = invoices_for(client, document_id)
    assert inv["method"] == "rules+llm" and inv["model"] == "groq:model-groq"


def test_injected_instruction_in_a_pdf_cannot_change_the_total_through_the_api(
    client, fake_llm, tmp_path
):
    fake_llm.script(llm_json(invoice_number="INV-7001", supplier_name="Initech LLC", total=0))
    document_id = upload(client, "inj.pdf", injection_pdf(tmp_path / "inj.pdf").read_bytes())
    assert document(client, document_id)["status"] == "completed"
    (inv,) = invoices_for(client, document_id)
    assert inv["total"] == "1150.00"  # the printed value, not the injected 0
    assert "Ignore previous instructions" not in fake_llm.calls[0].user
    assert any(i["rule_id"] == "V-08" for i in inv["issues"]) and inv["status"] == "needs_review"


def test_multipage_tiff_keeps_one_page_and_one_invoice_per_frame(client, fake_llm, fixtures_dir):
    fake_llm.script(llm_json(invoice_number="INV-1001"), llm_json(invoice_number="INV-2002"))
    document_id = upload(client, "multiframe.tif", (fixtures_dir / "multiframe.tif").read_bytes())
    doc = document(client, document_id)
    assert (doc["status"], doc["file_type"], doc["page_count"]) == ("completed", "image", 2)
    pages = client.get(f"{DOCS}/{document_id}/pages", headers=API_HEADERS).json()["items"]
    assert [(p["page_no"], p["method"]) for p in pages] == [(1, "ocr"), (2, "ocr")]
    invoices = invoices_for(client, document_id)
    assert [(i["invoice_number"], i["page_numbers"]) for i in invoices] == [
        ("INV-1001", [1]),
        ("INV-2002", [2]),
    ]
