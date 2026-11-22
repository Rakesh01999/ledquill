"""The same file uploaded twice (CLAUDE.md section 6, FR-12): two documents with one sha256,
the later invoice flagged V-07; reprocess replaces rows and never appends."""

from sqlalchemy import select

from app.db.models import Document, Invoice
from tests.conftest import API_HEADERS
from tests.fixtures.builders import MISMATCH_LLM, mismatch_pdf
from tests.integration.test_extraction_by_file_type import DOCS, invoices_for, upload


def test_same_file_twice_makes_two_documents_and_flags_only_the_later_invoice(
    client, fake_llm, tmp_path, db_session
):
    fake_llm.default = MISMATCH_LLM
    data = mismatch_pdf(tmp_path / "m.pdf").read_bytes()
    first_id, second_id = upload(client, "m.pdf", data), upload(client, "m.pdf", data)
    assert first_id != second_id
    docs = db_session.scalars(select(Document).order_by(Document.created_at)).all()
    assert len(docs) == 2 and docs[0].sha256 == docs[1].sha256
    (first,), (second,) = invoices_for(client, first_id), invoices_for(client, second_id)
    assert not any(i["rule_id"] == "V-07" for i in first["issues"])
    (v07,) = [i for i in second["issues"] if i["rule_id"] == "V-07"]
    assert v07["severity"] == "error" and second["status"] == "needs_review"
    assert v07["related_invoice_id"] == first["id"]


def test_reprocessing_the_later_duplicate_replaces_its_invoice_and_keeps_the_flag(
    client, fake_llm, tmp_path, db_session
):
    fake_llm.default = MISMATCH_LLM
    data = mismatch_pdf(tmp_path / "m.pdf").read_bytes()
    upload(client, "m.pdf", data)
    second_id = upload(client, "m.pdf", data)
    (before,) = invoices_for(client, second_id)
    r = client.post(f"{DOCS}/{second_id}/reprocess", headers=API_HEADERS)
    assert r.status_code == 202, r.text
    (after,) = invoices_for(client, second_id)
    assert after["id"] != before["id"]  # replaced, not appended
    assert db_session.scalar(select(Invoice.id).where(Invoice.id == before["id"])) is None
    assert len(db_session.scalars(select(Invoice)).all()) == 2
    assert [i["rule_id"] for i in after["issues"] if i["rule_id"] == "V-07"] == ["V-07"]
