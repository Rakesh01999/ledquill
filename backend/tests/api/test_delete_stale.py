"""DELETE /documents/{id} and reprocess of a stale (no progress) document."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from app.core.errors import PermanentError
from app.db.models import Correction, Document, Invoice, Job, Page, ProcessingEvent, ValidationIssue
from app.storage import get_storage
from tests.api.test_invoices import upload_mismatch
from tests.conftest import API_HEADERS
from tests.fixtures.builders import MISMATCH_LLM
from tests.helpers import seed_invoice

DOCS, INVOICES, JOBS = "/api/v1/documents", "/api/v1/invoices", "/api/v1/jobs"


def delete(client, document_id):
    return client.delete(f"{DOCS}/{document_id}", headers=API_HEADERS)


def reprocess(client, document_id):
    return client.post(f"{DOCS}/{document_id}/reprocess", headers=API_HEADERS)


def count(db_session, model) -> int:
    db_session.expire_all()
    return db_session.scalar(select(func.count()).select_from(model))


def make_idle(db_session, document_id, status: str, minutes: int) -> None:
    """The document (and its latest job) is `status`, with no activity for `minutes`."""
    stamp = datetime.now(UTC) - timedelta(minutes=minutes)
    db_session.execute(
        update(Document).where(Document.id == document_id).values(status=status, updated_at=stamp)
    )
    db_session.execute(update(Job).where(Job.document_id == document_id).values(status=status))
    db_session.commit()


def stored(key: str) -> bool:
    try:
        with get_storage().local_path(key):
            return True
    except PermanentError:
        return False


# --- delete -------------------------------------------------------------------------------


def test_delete_removes_every_trace_of_the_document(client, db_session, fake_llm, tmp_path):
    fake_llm.default = MISMATCH_LLM
    doc_id = upload_mismatch(client, tmp_path)
    (invoice,) = client.get(INVOICES, params={"document_id": doc_id}, headers=API_HEADERS).json()[
        "items"
    ]
    client.patch(f"{INVOICES}/{invoice['id']}", json={"total": "1150.00"}, headers=API_HEADERS)
    key = db_session.get(Document, uuid.UUID(doc_id)).storage_key
    assert stored(key) and count(db_session, Correction) == 1
    assert count(db_session, ProcessingEvent) > 0 and count(db_session, Page) > 0

    r = delete(client, doc_id)
    assert r.status_code == 204 and r.content == b""
    for model in (Document, Invoice, Correction, Job, Page, ProcessingEvent, ValidationIssue):
        assert count(db_session, model) == 0, model.__name__
    assert not stored(key)
    assert client.get(f"{DOCS}/{doc_id}", headers=API_HEADERS).status_code == 404
    assert client.get(f"{INVOICES}/{invoice['id']}", headers=API_HEADERS).status_code == 404
    assert client.get(f"{JOBS}/{invoice['id']}", headers=API_HEADERS).status_code == 404


def test_delete_a_failed_document(client, db_session):
    seeded = seed_invoice(db_session, document_status="failed")
    assert delete(client, seeded.document_id).status_code == 204


def test_delete_leaves_other_documents_alone(client, db_session):
    keep = seed_invoice(db_session, number="INV-1")
    gone = seed_invoice(db_session, number="INV-2")
    assert delete(client, gone.document_id).status_code == 204
    assert client.get(f"{INVOICES}/{keep.id}", headers=API_HEADERS).status_code == 200
    assert count(db_session, Document) == 1


def test_delete_clears_duplicate_flags_it_caused_on_other_invoices(client, db_session):
    first = seed_invoice(db_session, number="INV-77", supplier="Acme Supplies Ltd")
    second = seed_invoice(db_session, number="INV-77", supplier="Acme Supplies Ltd")
    flagged = client.get(f"{INVOICES}/{second.id}", headers=API_HEADERS).json()
    assert any(i["related_invoice_id"] == str(first.id) for i in flagged["issues"])
    assert delete(client, first.document_id).status_code == 204
    after = client.get(f"{INVOICES}/{second.id}", headers=API_HEADERS).json()
    assert all(i["related_invoice_id"] is None for i in after["issues"])
    assert after["status"] == "ready"


def test_delete_succeeds_even_if_the_file_is_already_gone(client, db_session):
    seeded = seed_invoice(db_session)  # seeded rows have no stored file at all
    assert delete(client, seeded.document_id).status_code == 204


@pytest.mark.parametrize("status", ["queued", "processing"])
def test_delete_while_a_job_is_progressing_is_409(client, db_session, status):
    seeded = seed_invoice(db_session, document_status=status)
    r = delete(client, seeded.document_id)
    assert r.status_code == 409 and r.headers["content-type"].startswith("application/problem+json")
    assert status in r.json()["detail"] and "15 minutes" in r.json()["detail"]
    assert count(db_session, Invoice) == 1  # untouched


@pytest.mark.parametrize("status", ["queued", "processing"])
def test_delete_a_stale_document_is_allowed(client, db_session, status):
    seeded = seed_invoice(db_session, document_status=status)
    make_idle(db_session, seeded.document_id, status, minutes=16)
    assert delete(client, seeded.document_id).status_code == 204
    assert count(db_session, Document) == 0


def test_delete_just_inside_the_timeout_is_still_409(client, db_session):
    seeded = seed_invoice(db_session, document_status="processing")
    make_idle(db_session, seeded.document_id, "processing", minutes=14)
    assert delete(client, seeded.document_id).status_code == 409


def test_the_stale_timeout_is_configurable(client, db_session, settings, monkeypatch):
    monkeypatch.setattr(settings, "ledquill_stale_job_minutes", 1)
    seeded = seed_invoice(db_session, document_status="processing")
    make_idle(db_session, seeded.document_id, "processing", minutes=2)
    assert delete(client, seeded.document_id).status_code == 204


def test_delete_errors_unknown_bad_id_and_missing_key(client, db_session):
    r = delete(client, uuid.uuid4())
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/problem+json")
    assert delete(client, "nope").status_code == 422
    seeded = seed_invoice(db_session)
    assert client.delete(f"{DOCS}/{seeded.document_id}").status_code == 401
    assert count(db_session, Document) == 1


def test_deleting_twice_is_404_the_second_time(client, db_session):
    seeded = seed_invoice(db_session)
    assert delete(client, seeded.document_id).status_code == 204
    assert delete(client, seeded.document_id).status_code == 404


# --- reprocess of a stale document ----------------------------------------------------------


def test_reprocess_a_stale_processing_document_supersedes_its_job(
    client, db_session, fake_llm, tmp_path
):
    fake_llm.default = MISMATCH_LLM
    doc_id = uuid.UUID(upload_mismatch(client, tmp_path))
    make_idle(db_session, doc_id, "processing", minutes=30)
    old_job = db_session.scalars(select(Job).where(Job.document_id == doc_id)).one()

    r = reprocess(client, doc_id)
    assert r.status_code == 202, r.text
    db_session.expire_all()
    assert db_session.get(Job, old_job.id).status == "failed"
    assert "Superseded" in db_session.get(Job, old_job.id).error
    new = client.get(f"{JOBS}/{r.json()['job_id']}", headers=API_HEADERS).json()
    assert new["kind"] == "reprocess" and new["status"] == "completed"
    assert client.get(f"{DOCS}/{doc_id}", headers=API_HEADERS).json()["status"] == "completed"
    assert db_session.scalar(select(func.count()).select_from(Invoice)) == 1  # no duplicates


def test_reprocess_a_stale_queued_document(client, db_session, fake_llm, tmp_path):
    fake_llm.default = MISMATCH_LLM
    doc_id = uuid.UUID(upload_mismatch(client, tmp_path))
    make_idle(db_session, doc_id, "queued", minutes=20)  # the queue lost the message
    assert reprocess(client, doc_id).status_code == 202


def test_reprocess_a_document_that_is_progressing_is_409_with_the_timeout(client, db_session):
    seeded = seed_invoice(db_session, document_status="processing")
    make_idle(db_session, seeded.document_id, "processing", minutes=5)
    r = reprocess(client, seeded.document_id)
    assert r.status_code == 409 and "15 minutes without progress" in r.json()["detail"]


def test_a_stale_document_with_a_correction_is_still_protected(client, db_session):
    seeded = seed_invoice(db_session, total="1200.00")
    client.patch(f"{INVOICES}/{seeded.id}", json={"total": "1150.00"}, headers=API_HEADERS)
    make_idle(db_session, seeded.document_id, "processing", minutes=60)
    r = reprocess(client, seeded.document_id)
    assert r.status_code == 409 and r.json()["corrections"] == 1
    db_session.expire_all()
    assert db_session.get(Job, db_session.scalars(select(Job.id)).one()).status == "processing"


def test_a_stale_document_with_an_approval_is_still_protected(client, db_session):
    seeded = seed_invoice(db_session)
    client.post(f"{INVOICES}/{seeded.id}/approve", headers=API_HEADERS)
    make_idle(db_session, seeded.document_id, "processing", minutes=60)
    r = reprocess(client, seeded.document_id)
    assert r.status_code == 409 and r.json()["approved_invoices"] == 1


def test_a_superseded_queued_job_is_skipped_when_it_finally_arrives(client, db_session):
    from app.workers.stages import run_job

    seeded = seed_invoice(db_session, document_status="queued")
    job = db_session.scalars(select(Job).where(Job.document_id == seeded.document_id)).one()
    job.status = "failed"  # a reprocess superseded it while it waited in the queue
    db_session.commit()
    assert run_job(db_session, seeded.document_id, job.id, final_attempt=False) == "superseded"
    db_session.expire_all()
    doc = db_session.get(Document, seeded.document_id)
    assert doc.status == "queued" and count(db_session, Page) == 0  # nothing ran


def test_the_document_reports_the_new_job_after_a_stale_queued_one_is_superseded(
    client, db_session, monkeypatch
):
    from app.services import documents as service

    monkeypatch.setattr(service.process_document, "delay", lambda *_a: None)  # stays queued
    seeded = seed_invoice(db_session, document_status="queued")
    make_idle(db_session, seeded.document_id, "queued", minutes=30)
    db_session.execute(
        update(Job).where(Job.document_id == seeded.document_id).values(started_at=None)
    )
    db_session.commit()

    r = reprocess(client, seeded.document_id)
    assert r.status_code == 202
    detail = client.get(f"{DOCS}/{seeded.document_id}", headers=API_HEADERS).json()
    assert detail["job_id"] == r.json()["job_id"] and detail["status"] == "queued"
    listed = client.get(DOCS, headers=API_HEADERS).json()["items"][0]
    assert listed["job_id"] == r.json()["job_id"]
