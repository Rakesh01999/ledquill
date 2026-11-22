"""Upload through the API, process with an eager Celery worker, read status back.
One end-to-end run per accepted file type, plus the failure scenarios."""

import io

import pytest
from sqlalchemy import select

from app.db.models import Job, Page, ProcessingEvent
from tests.conftest import API_HEADERS

URL = "/api/v1/documents"


def run_upload(client, fixtures_dir, name):
    data = (fixtures_dir / name).read_bytes()
    r = client.post(URL, files=[("files", (name, io.BytesIO(data)))], headers=API_HEADERS)
    assert r.status_code == 202, r.text
    item = r.json()["accepted"][0]
    status = client.get(f"{URL}/{item['document_id']}", headers=API_HEADERS)
    return item, status.json()


def pages_of(db_session, document_id):
    return db_session.scalars(
        select(Page).where(Page.document_id == document_id).order_by(Page.page_no)
    ).all()


@pytest.mark.parametrize(
    ("name", "file_type", "page_count", "method", "expected_text"),
    [
        ("digital.pdf", "pdf", 2, "text", "INV-2002"),
        ("scanned.png", "image", 1, "ocr", "INV-1001"),
        ("rotated_noisy.jpg", "image", 1, "ocr", "INV-1001"),
        ("multiframe.tif", "image", 2, "ocr", "INV-2002"),
        ("two_sheets.xlsx", "xlsx", 2, "sheet", "INV-2001"),
        ("legacy.xls", "xls", 1, "sheet", "INV-3001"),
        ("cp1252.csv", "csv", 1, "sheet", "Müller GmbH"),
    ],
)
def test_each_file_type_completes_and_produces_page_rows(
    client, db_session, fixtures_dir, name, file_type, page_count, method, expected_text
):
    item, status = run_upload(client, fixtures_dir, name)
    assert status["status"] == "completed" and status["progress"] == 100
    assert status["file_type"] == file_type and status["page_count"] == page_count
    assert status["error"] is None

    pages = pages_of(db_session, item["document_id"])
    assert len(pages) == page_count and {p.method for p in pages} == {method}
    assert expected_text in pages[-1].text
    if method == "ocr":
        assert all(p.ocr_confidence and p.ocr_confidence > 60 for p in pages)
    else:
        assert all(p.ocr_confidence is None for p in pages)

    events = db_session.scalars(
        select(ProcessingEvent).where(ProcessingEvent.status == "succeeded")
    ).all()
    assert [(e.stage, e.duration_ms is not None) for e in events] == [
        (stage, True) for stage in ("detect", "extract", "split", "fields", "validate")
    ]


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("corrupt.pdf", "no readable pages"),
        ("encrypted.pdf", "This PDF is password protected."),
    ],
)
def test_unreadable_pdfs_end_failed_with_reason_and_a_single_attempt(
    client, db_session, fixtures_dir, name, reason
):
    item, status = run_upload(client, fixtures_dir, name)
    assert status["status"] == "failed" and reason in status["error"]
    assert status["page_count"] is None and status["current_stage"] == "extract"
    job = db_session.get(Job, item["job_id"])
    assert (job.status, job.attempts) == ("failed", 1)
    assert pages_of(db_session, item["document_id"]) == []


def test_empty_file_is_rejected_at_upload_and_never_queued(client, fixtures_dir):
    r = client.post(URL, files=[("files", ("empty.pdf", b""))], headers=API_HEADERS)
    assert r.status_code == 400 and r.json()["rejected"][0]["reason"] == "The file is empty."
