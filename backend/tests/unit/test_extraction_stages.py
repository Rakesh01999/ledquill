"""Stages split, fields and validate through run_job, real DB and storage, FakeProvider LLM."""

from decimal import Decimal as D

import pytest
from openpyxl import Workbook
from PIL import Image
from sqlalchemy import func, select

from app.core.errors import TransientError
from app.db.models import Document, Invoice, ProcessingEvent, ValidationIssue
from app.llm.base import RateLimited
from app.pipeline.fields import extract_fields
from app.pipeline.split import Segment
from app.workers import stages
from app.workers.stages import run_job
from tests.fakes import llm_json
from tests.fixtures.builders import (
    MISMATCH_LLM,
    injection_pdf,
    invoice_page,
    mismatch_pdf,
    synonym_register_xlsx,
    template_xlsx,
    two_invoice_pdf,
    write_pdf,
)
from tests.helpers import create_document

pytestmark = pytest.mark.usefixtures("db_clean")


def process(session, path, *, final_attempt=False):
    doc, job = create_document(session, path)
    status = run_job(session, doc.id, job.id, final_attempt=final_attempt)
    session.expire_all()
    return doc, job, status


def invoices_of(session, doc) -> list[Invoice]:
    return list(
        session.scalars(
            select(Invoice).where(Invoice.document_id == doc.id).order_by(Invoice.created_at)
        )
    )


def issues_of(session, invoice) -> dict[str, ValidationIssue]:
    rows = session.scalars(select(ValidationIssue).where(ValidationIssue.invoice_id == invoice.id))
    return {f"{r.rule_id}:{r.field}": r for r in rows}


def clean_pdf(path, number="INV-8001"):
    page = invoice_page(
        number, "2026-09-05", "Initech LLC", "Globex Corp",
        [("Consulting", "1", "100.00", "100.00")], "100.00", "15.00", "115.00",
    )  # fmt: skip
    return write_pdf(path, [page])


CLEAN_LLM = llm_json(
    invoice_number="INV-8001", invoice_date="2026-09-05", supplier_name="Initech LLC",
    customer_name="Globex Corp", currency="USD", subtotal=100, tax=15, total=115,
)  # fmt: skip


def test_total_mismatch_flags_v05_and_keeps_what_the_model_said(db_session, fake_llm, tmp_path):
    fake_llm.script(MISMATCH_LLM)
    doc, _, status = process(db_session, mismatch_pdf(tmp_path / "m.pdf"))
    assert status == "completed"
    (inv,) = invoices_of(db_session, doc)
    assert (inv.invoice_number, inv.supplier_name, inv.currency) == (
        "INV-5001", "Acme Supplies Ltd", "USD",
    )  # fmt: skip
    assert (inv.subtotal, inv.tax, inv.total) == (D("1000.00"), D("150.00"), D("1200.00"))
    assert inv.status == "needs_review" and inv.method == "rules+llm"
    assert inv.model == "groq:model-groq" and inv.page_numbers == [1]
    assert len(inv.line_items) == 1 and inv.line_items[0].amount == D("1000.00")
    v05 = issues_of(db_session, inv)["V-05:total"]
    assert (v05.severity, v05.expected, v05.actual) == ("error", "1,150.00", "1,200.00")
    assert inv.raw_extraction["prompt_version"] == "extract-v1"
    assert D(inv.raw_extraction["llm"]["total"]) == D("1200.00")
    assert inv.raw_extraction["llm_status"] == "ok"
    assert "Total Due" not in str(inv.raw_extraction)  # audit data holds values, not the text


def test_two_invoice_pdf_is_split_and_extracted_per_invoice(db_session, fake_llm, tmp_path):
    fake_llm.script(
        llm_json(invoice_number="INV-6001", supplier_name="Acme Supplies Ltd", total=115),
        llm_json(invoice_number="INV-6002", supplier_name="Initech LLC", total=23),
    )
    doc, _, _ = process(db_session, two_invoice_pdf(tmp_path / "two.pdf"))
    first, second = invoices_of(db_session, doc)
    assert (first.invoice_number, first.page_numbers, first.total) == (
        "INV-6001", [1, 2], D("115.00"),
    )  # fmt: skip
    assert (second.invoice_number, second.page_numbers, second.total) == (
        "INV-6002", [3], D("23.00"),
    )  # fmt: skip
    assert len(fake_llm.calls) == 2
    assert "INV-6002" not in fake_llm.calls[0].user  # each call sees only its own pages


def test_spreadsheet_with_synonym_headers_needs_no_llm_call(db_session, fake_llm, tmp_path):
    doc, _, status = process(db_session, synonym_register_xlsx(tmp_path / "reg.xlsx"))
    assert status == "completed" and fake_llm.calls == []
    first, second = invoices_of(db_session, doc)
    assert (first.invoice_number, first.supplier_name, first.total) == (
        "INV-9001", "Delta Traders", D("230.00"),
    )  # fmt: skip
    assert (first.subtotal, first.tax, first.currency) == (D("200.00"), D("30.00"), "USD")
    assert first.method == "rules" and first.model is None and first.status == "ready"
    assert first.raw_extraction["llm_status"] == "skipped"
    assert second.status == "needs_review" and "V-05:total" in issues_of(db_session, second)


def test_spreadsheet_template_with_labels_only_yields_no_invoice(db_session, fake_llm, tmp_path):
    fake_llm.script(llm_json(invoice_number="INV-0001", supplier_name="Phantom Ltd", total=500))
    doc, job, status = process(db_session, template_xlsx(tmp_path / "form.xlsx"))
    assert status == "completed" and job.status == "completed"
    assert invoices_of(db_session, doc) == []  # never an invented invoice
    assert fake_llm.calls == []  # nothing to extract, so no tokens spent
    assert doc.error == "No invoice was found in this document."


def test_help_sheet_without_invoice_signal_is_skipped_but_the_invoice_sheet_is_kept(
    db_session, fake_llm, tmp_path
):
    wb = Workbook()
    ws = wb.active
    ws.title = "Invoice"
    for row in (["Invoice No:", "INV-5001"], ["Supplier:", "Acme Ltd"], ["Total:", "100.00"]):
        ws.append(row)
    help_sheet = wb.create_sheet("Help")
    for line in ("How to use this template", "Replace the labels with your details"):
        help_sheet.append([line])
    path = tmp_path / "two.xlsx"
    wb.save(path)
    fake_llm.script(llm_json(invoice_number="INV-5001", supplier_name="Acme Ltd", total=100))
    doc, _, status = process(db_session, path)
    assert status == "completed" and doc.error is None
    (inv,) = invoices_of(db_session, doc)
    assert inv.page_numbers == [1] and inv.invoice_number == "INV-5001"


def test_actual_llm_tokens_are_recorded_on_the_invoice_and_the_fields_event(
    db_session, fake_llm, tmp_path
):
    fake_llm.script(llm_json(invoice_number="INV-8001", supplier_name="Initech LLC", total=100))
    doc, _, status = process(db_session, clean_pdf(tmp_path / "ok.pdf"))
    assert status == "completed"
    (inv,) = invoices_of(db_session, doc)
    assert inv.raw_extraction["llm_tokens"] == {"prompt": 70, "completion": 30}
    event = db_session.scalars(
        select(ProcessingEvent).where(
            ProcessingEvent.document_id == doc.id,
            ProcessingEvent.stage == "fields",
            ProcessingEvent.status == "succeeded",
        )
    ).one()
    assert (event.detail["prompt_tokens"], event.detail["completion_tokens"]) == (70, 30)


def test_prompt_injection_cannot_force_the_total(db_session, fake_llm, tmp_path):
    fake_llm.script(llm_json(invoice_number="INV-7001", supplier_name="Initech LLC", total=0))
    doc, _, status = process(db_session, injection_pdf(tmp_path / "inj.pdf"))
    assert status == "completed"
    (inv,) = invoices_of(db_session, doc)
    assert inv.total == D("1150.00")  # the printed value, not the injected 0
    assert "Ignore previous instructions" not in fake_llm.calls[0].user
    assert inv.raw_extraction["injection_lines_removed"] == 1
    assert inv.status == "needs_review"
    assert any(i.rule_id == "V-08" and "instructions" in i.message
               for i in issues_of(db_session, inv).values())  # fmt: skip


def test_after_the_final_retry_rule_results_are_kept_and_the_invoice_needs_review(
    db_session, fake_llm, tmp_path
):
    fake_llm.script(RateLimited("429"))  # the only configured model is rate limited
    doc, job, status = process(db_session, mismatch_pdf(tmp_path / "m.pdf"), final_attempt=True)
    assert status == "completed"
    session_doc = db_session.get(Document, doc.id)
    assert session_doc.status == "completed" and session_doc.error is None
    (inv,) = invoices_of(db_session, doc)
    assert inv.invoice_number == "INV-5001" and inv.total == D("1200.00")  # rule results kept
    assert inv.method == "rules" and inv.model is None
    assert inv.raw_extraction["llm_status"] == "unavailable"
    assert inv.status == "needs_review"
    unavailable = [i for i in issues_of(db_session, inv).values() if "unavailable" in i.message]
    assert len(unavailable) == 1 and unavailable[0].rule_id == "V-08"


def test_all_models_exhausted_before_the_final_retry_raises_a_transient_error(
    db_session, fake_llm, tmp_path
):
    fake_llm.script(RateLimited("429"))
    doc, job = create_document(db_session, mismatch_pdf(tmp_path / "m.pdf"))
    with pytest.raises(TransientError):
        run_job(db_session, doc.id, job.id, final_attempt=False)


def test_a_retry_after_a_transient_llm_failure_completes_without_duplicates(
    db_session, fake_llm, tmp_path
):
    fake_llm.script(RateLimited("429"), MISMATCH_LLM)
    doc, job = create_document(db_session, mismatch_pdf(tmp_path / "m.pdf"))
    with pytest.raises(TransientError):
        run_job(db_session, doc.id, job.id, final_attempt=False)
    assert run_job(db_session, doc.id, job.id, final_attempt=False) == "completed"
    assert len(invoices_of(db_session, doc)) == 1


def test_one_failing_invoice_does_not_fail_the_document(
    db_session, fake_llm, tmp_path, monkeypatch
):
    calls = {"n": 0}

    def flaky(segment, get_llm, *, final_attempt):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return extract_fields(segment, get_llm, final_attempt=final_attempt)

    monkeypatch.setattr(stages, "extract_fields", flaky)
    fake_llm.script(llm_json(invoice_number="INV-6001", supplier_name="Acme Supplies Ltd"))
    doc, _, status = process(db_session, two_invoice_pdf(tmp_path / "two.pdf"))
    assert status == "completed" and db_session.get(Document, doc.id).status == "completed"
    first, second = invoices_of(db_session, doc)
    assert first.invoice_number == "INV-6001"
    assert second.invoice_number == "INV-6002"  # the rules still read it
    assert second.raw_extraction["llm_status"] == "error" and second.status == "needs_review"


def test_rerunning_the_job_rebuilds_invoices_instead_of_duplicating(db_session, fake_llm, tmp_path):
    fake_llm.script(MISMATCH_LLM)
    doc, job, _ = process(db_session, mismatch_pdf(tmp_path / "m.pdf"))
    first_issues = len(issues_of(db_session, invoices_of(db_session, doc)[0]))
    run_job(db_session, doc.id, job.id, final_attempt=False)
    assert db_session.scalar(select(func.count()).select_from(Invoice)) == 1
    (inv,) = invoices_of(db_session, doc)
    assert len(issues_of(db_session, inv)) == first_issues
    assert len(fake_llm.calls) == 1  # the second run came from the cache


def test_same_file_uploaded_twice_flags_v07_on_the_later_one(db_session, fake_llm, tmp_path):
    fake_llm.script(CLEAN_LLM, CLEAN_LLM)
    path = clean_pdf(tmp_path / "a.pdf")
    first_doc, _, _ = process(db_session, path)
    second_doc, _, _ = process(db_session, path)
    (first,), (second,) = invoices_of(db_session, first_doc), invoices_of(db_session, second_doc)
    assert first.status == "ready" and issues_of(db_session, first) == {}
    dup = issues_of(db_session, second)["V-07:None"]
    assert (dup.severity, dup.related_invoice_id) == ("error", first.id)
    assert second.status == "needs_review" and "exact file" in dup.message


def test_reprocessing_a_document_that_others_point_at_does_not_break(
    db_session, fake_llm, tmp_path
):
    fake_llm.script(CLEAN_LLM, CLEAN_LLM)
    path = clean_pdf(tmp_path / "a.pdf")
    first_doc, first_job, _ = process(db_session, path)
    second_doc, _, _ = process(db_session, path)
    run_job(db_session, first_doc.id, first_job.id, final_attempt=False)  # FK must not block this
    db_session.expire_all()
    (first,), (second,) = invoices_of(db_session, first_doc), invoices_of(db_session, second_doc)
    assert issues_of(db_session, second) == {} and second.status == "ready"  # stale issue purged
    assert issues_of(db_session, first)["V-07:None"].related_invoice_id == second.id


def test_pdf_and_spreadsheet_copies_that_disagree_raise_v09_with_the_related_invoice(
    db_session, fake_llm, tmp_path
):
    register_doc, _, _ = process(db_session, synonym_register_xlsx(tmp_path / "reg.xlsx"))
    (register_inv, _) = invoices_of(db_session, register_doc)
    page = invoice_page(
        "INV-9001", "2026-08-03", "Delta Traders", "Globex Corp",
        [("Goods", "1", "200.00", "200.00")], "200.00", "50.00", "250.00",
    )  # fmt: skip
    fake_llm.script(
        llm_json(
            invoice_number="INV-9001",
            invoice_date="2026-08-03",
            supplier_name="Delta Traders",
            subtotal=200,
            tax=50,
            total=250,
        )
    )
    pdf_doc, _, _ = process(db_session, write_pdf(tmp_path / "inv.pdf", [page]))
    (pdf_inv,) = invoices_of(db_session, pdf_doc)
    issues = issues_of(db_session, pdf_inv)
    v09 = issues["V-09:total"]
    assert (v09.severity, v09.expected, v09.actual) == ("error", "230.00", "250.00")
    assert v09.related_invoice_id == register_inv.id and "reg.xlsx" in v09.message
    assert "V-09:invoice_date" not in issues and "V-09:supplier_name" not in issues
    assert "V-07:invoice_number" in issues  # same supplier + number is also a duplicate
    assert pdf_inv.status == "needs_review"


NOISY_OCR = "Faitewick Catering tia rine Utlbronk Foods ne wo FASB Tae Be wT Sealer Reema ee pais"


def test_noisy_ocr_text_without_an_invoice_signal_still_goes_to_the_model(fake_llm):
    fake_llm.script(llm_json(supplier_name="Fairwick Catering"))
    outcome = extract_fields(
        Segment([1], NOISY_OCR, ocr=True), lambda: fake_llm.client, final_attempt=False
    )
    assert len(fake_llm.calls) == 1 and outcome.raw["llm_status"] != "poor_scan"


def test_ocr_text_with_almost_nothing_readable_becomes_a_poor_scan_not_a_silent_drop(fake_llm):
    outcome = extract_fields(
        Segment([1], ": ; ; 4 Se SOI.", ocr=True), lambda: fake_llm.client, final_attempt=False
    )
    assert fake_llm.calls == [] and outcome.raw["llm_status"] == "poor_scan"
    assert outcome.model is None and outcome.result.total is None


def test_a_near_blank_scan_ends_as_a_needs_review_invoice_that_explains_the_scan(
    db_session, fake_llm, tmp_path
):
    image = Image.new("L", (400, 300), 255)
    path = tmp_path / "faint.png"
    image.save(path)
    doc, _, status = process(db_session, path)
    assert status == "completed" and doc.error is None  # a scan is never a quiet "no invoice"
    (inv,) = invoices_of(db_session, doc)
    assert inv.status == "needs_review" and fake_llm.calls == []
    issues = issues_of(db_session, inv).values()
    assert any(i.rule_id == "V-08" and "scan" in i.message for i in issues)


def test_text_pdf_with_indian_digit_grouping_keeps_the_totals(db_session, fake_llm, tmp_path):
    # regression (clean_13.pdf): "10,50,125.00" was read as 10.50, so grounding nulled the totals
    page = [
        "Rilmoor Industrial Enterprise", "Invoice No: TX-006548", "Invoice Date: 2026-03-01",
        "Bill To: Altamere Works", "Currency: BDT",
        "Machining 1 10,50,125.00 10,50,125.00",
        "Subtotal BDT 10,50,125.00", "VAT (7.5%) 78,759.38", "Total 11,28,884.38",
    ]  # fmt: skip
    fake_llm.script(
        llm_json(
            invoice_number="TX-006548",
            supplier_name="Rilmoor Industrial Enterprise",
            currency="BDT",
            subtotal=1050125.00,
            tax=78759.38,
            total=1128884.38,
            line_items=[
                {
                    "description": "Machining",
                    "quantity": 1,
                    "unit_price": 1050125.00,
                    "amount": 1050125.00,
                }
            ],
        )  # fmt: skip
    )
    doc, _, status = process(db_session, write_pdf(tmp_path / "in.pdf", [page]))
    assert status == "completed"
    (inv,) = invoices_of(db_session, doc)
    assert (inv.subtotal, inv.total) == (D("1050125.00"), D("1128884.38"))
    assert inv.raw_extraction["nulled_by_grounding"] == []
    assert inv.line_items[0].amount == D("1050125.00") and inv.status == "ready"
