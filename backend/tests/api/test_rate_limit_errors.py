"""Rate limiting on upload and the RFC 7807 shape of every error the API can return."""

import io
import uuid

import pytest
from fastapi import APIRouter

from tests.conftest import API_HEADERS
from tests.fixtures.builders import MISMATCH_LLM, mismatch_pdf

DOCS, INVOICES = "/api/v1/documents", "/api/v1/invoices"
PROBLEM = "application/problem+json"


def assert_problem(response, status: int) -> dict:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith(PROBLEM)
    body = response.json()
    assert {"type", "title", "status", "detail"} <= body.keys() and body["status"] == status
    assert body["detail"]
    return body


def upload(client, tmp_path, headers=API_HEADERS):
    data = mismatch_pdf(tmp_path / "m.pdf").read_bytes()
    return client.post(DOCS, files=[("files", ("m.pdf", io.BytesIO(data)))], headers=headers)


# --- rate limit ---------------------------------------------------------------------------


def test_upload_is_limited_with_retry_after(client, settings, monkeypatch, tmp_path, fake_llm):
    fake_llm.default = MISMATCH_LLM
    monkeypatch.setattr(settings, "ledquill_rate_limit_upload", "2/minute")
    assert upload(client, tmp_path).status_code == 202
    assert upload(client, tmp_path).status_code == 202
    blocked = upload(client, tmp_path)
    body = assert_problem(blocked, 429)
    assert "2 per 1 minute" in body["detail"]
    assert 1 <= int(blocked.headers["retry-after"]) <= 60


def test_a_blocked_upload_stores_nothing(client, settings, monkeypatch, tmp_path, fake_llm):
    fake_llm.default = MISMATCH_LLM
    monkeypatch.setattr(settings, "ledquill_rate_limit_upload", "1/minute")
    upload(client, tmp_path)
    assert upload(client, tmp_path).status_code == 429
    assert client.get(DOCS, headers=API_HEADERS).json()["total"] == 1


def test_limits_are_per_api_key_and_other_endpoints_are_not_limited(
    client, settings, monkeypatch, tmp_path, fake_llm
):
    fake_llm.default = MISMATCH_LLM
    monkeypatch.setattr(settings, "ledquill_rate_limit_upload", "1/minute")
    assert upload(client, tmp_path).status_code == 202
    assert upload(client, tmp_path).status_code == 429
    for _ in range(5):  # reads share no counter with upload
        assert client.get(DOCS, headers=API_HEADERS).status_code == 200


def test_unauthenticated_requests_never_reach_the_limiter(client, settings, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ledquill_rate_limit_upload", "1/minute")
    for _ in range(3):
        assert_problem(upload(client, tmp_path, headers={}), 401)


def test_a_malformed_limit_setting_is_refused_at_startup():
    from pydantic import ValidationError

    from app.core.settings import Settings

    with pytest.raises(ValidationError):
        Settings(ledquill_rate_limit_upload="lots")


# --- every error is problem+json ------------------------------------------------------------


def test_401_missing_and_wrong_key(client):
    assert_problem(client.get(DOCS), 401)
    assert_problem(client.get(DOCS, headers={"X-API-Key": "wrong"}), 401)


def test_404_unknown_route_and_unknown_resources(client):
    assert_problem(client.get("/api/v1/nope", headers=API_HEADERS), 404)
    for path in (f"{DOCS}/{uuid.uuid4()}", f"{INVOICES}/{uuid.uuid4()}"):
        assert_problem(client.get(path, headers=API_HEADERS), 404)


def test_405_wrong_method(client):
    assert_problem(client.delete(DOCS, headers=API_HEADERS), 405)
    assert_problem(client.put(f"{INVOICES}/{uuid.uuid4()}", headers=API_HEADERS), 405)


def test_422_validation_lists_the_offending_fields(client):
    body = assert_problem(client.get(DOCS, params={"limit": 0}, headers=API_HEADERS), 422)
    assert body["errors"][0]["loc"] == ["query", "limit"]
    body = assert_problem(
        client.patch(f"{INVOICES}/{uuid.uuid4()}", json={"total": 1.5}, headers=API_HEADERS), 422
    )
    assert body["errors"][0]["loc"][:2] == ["body", "total"]


def test_422_does_not_echo_the_submitted_value(client):
    submitted = "zq-unique-marker-123"
    r = client.patch(
        f"{INVOICES}/{uuid.uuid4()}", json={"currency": submitted}, headers=API_HEADERS
    )
    assert_problem(r, 422)
    assert submitted not in r.text


def test_upload_failures_are_problem_json(client):
    assert_problem(client.post(DOCS, headers=API_HEADERS), 400)  # no files
    r = client.post(
        DOCS,
        files=[("files", ("x.exe", io.BytesIO(b"MZ\x90\x00not allowed")))],
        headers=API_HEADERS,
    )
    assert_problem(r, 415)


def test_500_is_problem_json_and_hides_internals(app, client):
    router = APIRouter()

    @router.get("/boom")
    def boom():
        raise RuntimeError("database password is hunter2")

    app.include_router(router)
    body = assert_problem(client.get("/boom"), 500)
    assert "hunter2" not in str(body)
