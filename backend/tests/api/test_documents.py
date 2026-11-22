import hashlib
import io

import pytest
from kombu.exceptions import OperationalError as KombuOperationalError
from sqlalchemy import select

from app.core.settings import get_settings
from app.db.models import Document, Job
from app.storage import get_storage
from app.workers.tasks import process_document
from tests.conftest import API_HEADERS

URL = "/api/v1/documents"
PDF_BYTES = b"%PDF-1.4\n" + b"0" * 200


@pytest.fixture
def enqueued(monkeypatch):
    """Record queued tasks instead of running the pipeline."""
    calls = []
    monkeypatch.setattr(process_document, "delay", lambda *a: calls.append(a))
    return calls


@pytest.fixture
def limits(app):
    def apply(**overrides):
        app.dependency_overrides[get_settings] = lambda: get_settings().model_copy(update=overrides)

    return apply


def upload(client, *files, field="files", headers=API_HEADERS):
    parts = [(field, (name, io.BytesIO(data), "application/octet-stream")) for name, data in files]
    return client.post(URL, files=parts, headers=headers)


def fixture_bytes(fixtures_dir, name):
    return (fixtures_dir / name).read_bytes()


def test_missing_key_is_401_problem_json(client, enqueued):
    r = client.post(URL, files=[("files", ("a.pdf", PDF_BYTES))])
    assert r.status_code == 401
    assert r.headers["content-type"].startswith("application/problem+json")
    assert enqueued == []


def test_wrong_key_is_401(client, enqueued):
    r = upload(client, ("a.pdf", PDF_BYTES), headers={"X-API-Key": "nope"})
    assert r.status_code == 401


def test_get_without_key_is_401(client):
    assert client.get(f"{URL}/00000000-0000-0000-0000-000000000000").status_code == 401


def test_unconfigured_key_refuses_everyone(app, client, enqueued):
    app.dependency_overrides[get_settings] = lambda: get_settings().model_copy(
        update={"ledquill_api_key": ""}
    )
    assert upload(client, ("a.pdf", PDF_BYTES), headers={"X-API-Key": ""}).status_code == 401


def test_upload_accepts_creates_rows_stores_file_and_enqueues(client, enqueued, db_session):
    r = upload(client, ("Invoice 1.pdf", PDF_BYTES))
    assert r.status_code == 202
    body = r.json()
    assert body["rejected"] == []
    (item,) = body["accepted"]
    assert item["filename"] == "Invoice 1.pdf" and item["status"] == "queued"
    assert enqueued == [(item["document_id"], item["job_id"])]

    doc = db_session.scalars(select(Document)).one()
    job = db_session.scalars(select(Job)).one()
    assert str(doc.id) == item["document_id"] and str(job.id) == item["job_id"]
    assert (doc.file_type, doc.mime_type, doc.status, doc.progress) == (
        "pdf",
        "application/pdf",
        "queued",
        0,
    )
    assert doc.sha256 == hashlib.sha256(PDF_BYTES).hexdigest()
    assert doc.size_bytes == len(PDF_BYTES)
    assert doc.storage_key == f"documents/{doc.id}/Invoice 1.pdf"
    assert (job.kind, job.status, job.document_id) == ("process", "queued", doc.id)
    with get_storage().local_path(doc.storage_key) as path:
        assert path.read_bytes() == PDF_BYTES


def test_openapi_body_has_a_single_files_field_of_binary_items(client):
    schema = client.get("/openapi.json").json()
    body = schema["components"]["schemas"]["Body_upload_documents_api_v1_documents_post"]
    assert list(body["properties"]) == ["files"]
    assert body["properties"]["files"]["items"] == {"type": "string", "format": "binary"}


def test_old_bracket_field_name_is_no_longer_read(client, enqueued):
    r = upload(client, ("a.pdf", PDF_BYTES), field="files[]")
    assert r.status_code == 400 and "No files" in r.json()["detail"]
    assert enqueued == []


def test_client_path_in_filename_never_reaches_the_storage_key(client, enqueued, db_session):
    upload(client, ("../../etc/evil.pdf", PDF_BYTES))
    doc = db_session.scalars(select(Document)).one()
    assert doc.filename == "evil.pdf" and ".." not in doc.storage_key


def test_same_file_twice_is_accepted_both_times_with_equal_hash(client, enqueued, db_session):
    r = upload(client, ("a.pdf", PDF_BYTES), ("b.pdf", PDF_BYTES))
    assert r.status_code == 202 and len(r.json()["accepted"]) == 2
    hashes = {d.sha256 for d in db_session.scalars(select(Document))}
    assert len(hashes) == 1


def test_partial_rejection_returns_202_with_both_lists(client, enqueued, db_session):
    r = upload(
        client,
        ("good.pdf", PDF_BYTES),
        ("tool.exe", b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 50),
        ("blank.pdf", b""),
    )
    assert r.status_code == 202
    body = r.json()
    assert [a["filename"] for a in body["accepted"]] == ["good.pdf"]
    assert {(x["filename"], x["status"]) for x in body["rejected"]} == {
        ("tool.exe", 415),
        ("blank.pdf", 400),
    }
    assert all(x["reason"] for x in body["rejected"])
    assert len(enqueued) == 1
    assert db_session.scalars(select(Document)).all().__len__() == 1


@pytest.mark.parametrize("key", ["docx_as_xlsx", "zip_as_xlsx", "text_as_pdf"])
def test_disguised_files_are_415_whatever_their_name(client, enqueued, tmp_path, key):
    from tests.fixtures.generate import make_disguises

    path = make_disguises(tmp_path)[key]
    r = upload(client, (path.name, path.read_bytes()))
    assert r.status_code == 415
    body = r.json()
    assert body["status"] == 415 and body["rejected"][0]["status"] == 415
    assert enqueued == []


def test_pdf_renamed_jpg_is_accepted_as_a_pdf(client, enqueued, db_session, tmp_path):
    from tests.fixtures.generate import make_disguises

    path = make_disguises(tmp_path)["pdf_as_jpg"]
    assert upload(client, ("invoice.jpg", path.read_bytes())).status_code == 202
    assert db_session.scalars(select(Document)).one().file_type == "pdf"


def test_all_files_unsupported_returns_415_problem_with_reasons(client, enqueued):
    r = upload(client, ("a.txt", b"plain prose only"), ("b.bin", b"\x00\x01\x02" * 30))
    assert r.status_code == 415
    assert r.headers["content-type"].startswith("application/problem+json")
    assert [x["filename"] for x in r.json()["rejected"]] == ["a.txt", "b.bin"]


def test_all_empty_returns_400(client, enqueued):
    assert upload(client, ("a.pdf", b"")).status_code == 400


def test_mixed_failure_statuses_collapse_to_400(client, enqueued):
    r = upload(client, ("a.pdf", b""), ("b.txt", b"prose"))
    assert r.status_code == 400 and len(r.json()["rejected"]) == 2


def test_oversized_single_file_is_413_and_nothing_is_kept(client, enqueued, limits, db_session):
    limits(ledquill_max_upload_mb=1)
    r = upload(client, ("big.pdf", PDF_BYTES + b"0" * (1024 * 1024)))
    assert r.status_code == 413
    assert r.json()["rejected"][0]["reason"] == "Larger than 1 MB."
    assert db_session.scalars(select(Document)).all() == []
    assert enqueued == []
    from pathlib import Path

    stored = [p for p in Path(get_settings().storage_local_dir).rglob("big.pdf")]
    assert stored == []


def test_file_exactly_at_the_limit_is_accepted(client, enqueued, limits):
    limits(ledquill_max_upload_mb=1)
    data = PDF_BYTES + b"0" * (1024 * 1024 - len(PDF_BYTES))
    assert upload(client, ("edge.pdf", data)).status_code == 202


def test_oversized_file_among_good_ones_is_rejected_individually(client, enqueued, limits):
    limits(ledquill_max_upload_mb=1)
    r = upload(client, ("ok.pdf", PDF_BYTES), ("big.pdf", PDF_BYTES + b"0" * (1024 * 1024)))
    assert r.status_code == 202
    assert r.json()["rejected"][0]["status"] == 413


def test_too_many_files_is_400_and_stores_nothing(client, enqueued, limits, db_session):
    limits(ledquill_max_files_per_request=2)
    r = upload(client, *[(f"{n}.pdf", PDF_BYTES) for n in range(3)])
    assert r.status_code == 400 and "At most 2 files" in r.json()["detail"]
    assert db_session.scalars(select(Document)).all() == []


def test_request_without_files_is_400(client, enqueued):
    r = client.post(URL, headers=API_HEADERS, data={"x": "y"})
    assert r.status_code == 400


def test_queue_outage_marks_the_document_failed_and_reports_503(client, monkeypatch, db_session):
    def broken(*_):
        raise KombuOperationalError("redis down")

    monkeypatch.setattr(process_document, "delay", broken)
    r = upload(client, ("a.pdf", PDF_BYTES))
    assert r.status_code == 503
    doc = db_session.scalars(select(Document)).one()
    assert doc.status == "failed" and "queue is unavailable" in doc.error


def test_get_document_returns_status_progress_error_and_page_count(client, enqueued):
    item = upload(client, ("a.pdf", PDF_BYTES)).json()["accepted"][0]
    r = client.get(f"{URL}/{item['document_id']}", headers=API_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == item["document_id"] and body["job_id"] == item["job_id"]
    assert (body["status"], body["progress"], body["error"], body["page_count"]) == (
        "queued",
        0,
        None,
        None,
    )
    assert body["current_stage"] is None and body["filename"] == "a.pdf"
    assert "storage_key" not in body and "sha256" not in body


def test_get_unknown_document_is_404(client):
    r = client.get(f"{URL}/00000000-0000-0000-0000-000000000000", headers=API_HEADERS)
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")


def test_get_with_malformed_id_is_422(client):
    assert client.get(f"{URL}/not-a-uuid", headers=API_HEADERS).status_code == 422
