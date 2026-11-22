"""POST /documents/{id}/reprocess and GET /stats (FR-15, FR-16, NFR-03, NFR-06)."""

import io
import uuid

import pytest
from kombu.exceptions import KombuError

from app.db.models import Document, Invoice, Job, ProcessingEvent
from tests.api.test_invoices import upload_mismatch
from tests.conftest import API_HEADERS
from tests.fixtures.builders import MISMATCH_LLM, two_invoice_pdf
from tests.helpers import seed_invoice

DOCS, INVOICES, STATS = "/api/v1/documents", "/api/v1/invoices", "/api/v1/stats"


def reprocess(client, document_id):
    return client.post(f"{DOCS}/{document_id}/reprocess", headers=API_HEADERS)


def invoices_of(client, document_id) -> dict:
    return client.get(INVOICES, params={"document_id": document_id}, headers=API_HEADERS).json()


# --- reprocess ----------------------------------------------------------------------------


def test_reprocess_reruns_the_job_without_duplicating_invoices(
    client, fake_llm, tmp_path, db_session
):
    fake_llm.default = MISMATCH_LLM
    pdf = two_invoice_pdf(tmp_path / "two.pdf").read_bytes()
    up = client.post(DOCS, files=[("files", ("two.pdf", io.BytesIO(pdf)))], headers=API_HEADERS)
    doc_id = up.json()["accepted"][0]["document_id"]
    before = invoices_of(client, doc_id)
    assert before["total"] == 2

    r = reprocess(client, doc_id)
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]
    assert r.json()["document_id"] == doc_id and r.json()["status"] == "queued"

    after = invoices_of(client, doc_id)
    assert after["total"] == 2  # rebuilt, not doubled
    assert {i["id"] for i in after["items"]}.isdisjoint({i["id"] for i in before["items"]})
    assert db_session.query(Invoice).count() == 2
    job = client.get(f"/api/v1/jobs/{job_id}", headers=API_HEADERS).json()
    assert job["kind"] == "reprocess" and job["status"] == "completed"
    assert db_session.query(Job).filter_by(document_id=doc_id).count() == 2
    doc = client.get(f"{DOCS}/{doc_id}", headers=API_HEADERS).json()
    assert doc["status"] == "completed" and doc["job_id"] == job_id


def test_reprocess_twice_in_a_row_still_has_one_set_of_invoices(client, fake_llm, tmp_path):
    fake_llm.default = MISMATCH_LLM
    doc_id = upload_mismatch(client, tmp_path)
    for _ in range(2):
        assert reprocess(client, doc_id).status_code == 202
    assert invoices_of(client, doc_id)["total"] == 1


def test_reprocess_a_failed_document(client, db_session, tmp_path, fake_llm):
    fake_llm.default = MISMATCH_LLM
    doc_id = upload_mismatch(client, tmp_path)
    doc = db_session.get(Document, uuid.UUID(doc_id))
    doc.status, doc.error = "failed", "Unexpected error while processing this file."
    db_session.commit()
    assert reprocess(client, doc_id).status_code == 202
    detail = client.get(f"{DOCS}/{doc_id}", headers=API_HEADERS).json()
    assert detail["status"] == "completed" and detail["error"] is None


@pytest.mark.parametrize("status", ["queued", "processing"])
def test_reprocess_while_a_job_is_running_is_409(client, db_session, status):
    invoice = seed_invoice(db_session, document_status=status)
    r = reprocess(client, invoice.document_id)
    assert r.status_code == 409 and r.headers["content-type"].startswith("application/problem+json")
    assert status in r.json()["detail"]


def test_reprocess_is_refused_after_a_correction(client, db_session):
    invoice = seed_invoice(db_session, total="1200.00")
    client.patch(f"{INVOICES}/{invoice.id}", json={"total": "1150.00"}, headers=API_HEADERS)
    r = reprocess(client, invoice.document_id)
    assert r.status_code == 409
    assert "1 reviewer correction" in r.json()["detail"] and r.json()["corrections"] == 1
    assert db_session.query(Job).filter_by(document_id=invoice.document_id).count() == 1


def test_reprocess_is_refused_after_approval(client, db_session):
    invoice = seed_invoice(db_session)
    client.post(f"{INVOICES}/{invoice.id}/approve", headers=API_HEADERS)
    r = reprocess(client, invoice.document_id)
    assert r.status_code == 409 and r.json()["approved_invoices"] == 1
    assert "1 approval" in r.json()["detail"]
    assert (
        client.get(f"{INVOICES}/{invoice.id}", headers=API_HEADERS).json()["status"] == "approved"
    )


def test_reprocess_errors_unknown_bad_id_and_missing_key(client, db_session):
    assert reprocess(client, uuid.uuid4()).status_code == 404
    assert reprocess(client, "nope").status_code == 422
    seeded = seed_invoice(db_session)
    assert client.post(f"{DOCS}/{seeded.document_id}/reprocess").status_code == 401


def test_reprocess_with_the_queue_down_fails_the_job_with_a_reason(client, db_session, monkeypatch):
    from app.services import documents as service

    def down(*_args, **_kwargs):
        raise KombuError("broker down")

    monkeypatch.setattr(service.process_document, "delay", down)
    invoice = seed_invoice(db_session)
    r = reprocess(client, invoice.document_id)
    assert r.status_code == 503 and r.headers["content-type"].startswith("application/problem")
    db_session.expire_all()
    doc = db_session.get(Document, invoice.document_id)
    assert doc.status == "failed" and "queue is unavailable" in doc.error
    assert reprocess(client, invoice.document_id).status_code == 503  # still retryable


# --- stats --------------------------------------------------------------------------------


def test_stats_on_an_empty_database_reports_zeros_and_nulls(client):
    body = client.get(STATS, headers=API_HEADERS).json()
    assert body["documents"] == {
        "total": 0,
        "by_status": {"queued": 0, "processing": 0, "completed": 0, "failed": 0},
    }
    assert body["invoices"]["by_status"] == {"needs_review": 0, "ready": 0, "approved": 0}
    assert body["needs_review"] == 0
    # nothing finished yet: no rate or average is invented
    assert body["success_rate"] is None and body["failure_rate"] is None
    assert body["avg_processing_seconds"] is None and body["avg_stage_ms"] == {}


def test_stats_counts_statuses_and_averages(client, db_session):
    ready = seed_invoice(db_session)  # completed, job took 4 s
    seed_invoice(db_session, number="INV-2", total="1200.00")  # completed, needs_review
    seed_invoice(db_session, number="INV-3", document_status="failed")
    seed_invoice(db_session, number="INV-4", document_status="processing")
    client.post(f"{INVOICES}/{ready.id}/approve", headers=API_HEADERS)
    doc = db_session.get(Document, ready.document_id)
    for ms in (100, 300):
        db_session.add(
            ProcessingEvent(document_id=doc.id, stage="fields", status="succeeded", duration_ms=ms)
        )
    db_session.add(
        ProcessingEvent(document_id=doc.id, stage="fields", status="failed", duration_ms=9999)
    )
    db_session.commit()

    body = client.get(STATS, headers=API_HEADERS).json()
    assert body["documents"]["total"] == 4
    assert body["documents"]["by_status"] == {
        "queued": 0,
        "processing": 1,
        "completed": 2,
        "failed": 1,
    }
    assert body["invoices"]["total"] == 4
    assert body["invoices"]["by_status"]["approved"] == 1
    assert body["needs_review"] == body["invoices"]["by_status"]["needs_review"] == 1
    assert body["success_rate"] == pytest.approx(2 / 3, abs=1e-3)
    assert body["failure_rate"] == pytest.approx(1 / 3, abs=1e-3)
    assert body["avg_processing_seconds"] == pytest.approx(4.0, abs=0.1)
    assert body["avg_stage_ms"] == {"fields": 200}  # failed runs are not averaged in


def test_stats_requires_the_api_key(client):
    r = client.get(STATS)
    assert r.status_code == 401 and r.headers["content-type"].startswith("application/problem+json")
