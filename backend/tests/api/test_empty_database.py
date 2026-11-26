"""A system with no data is a normal state: every list, stats and search endpoint answers 200 with
an empty, well-formed body, and a missing id is a 404. A real server error stays a 500."""

import uuid

import pytest

from app.db.session import get_session
from tests.conftest import API_HEADERS

API = "/api/v1"
MISSING = uuid.uuid4()

LISTS = [
    "/documents",
    "/documents?archived=true",
    "/documents?status=failed&file_type=pdf&supplier=x&currency=EUR",
    "/invoices",
    "/invoices?archived=true",
    "/invoices?sort=severity",
    "/invoices?sort=supplier&order=asc",
    "/invoices/facets",
]


@pytest.mark.parametrize("path", LISTS)
def test_lists_are_empty_not_errors(client, path):
    r = client.get(API + path, headers=API_HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    if path.endswith("/facets"):
        assert all(not v for v in body.values())
    else:
        assert body["items"] == [] and body["total"] == 0


def test_stats_on_an_empty_database(client):
    r = client.get(f"{API}/stats", headers=API_HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["documents"]["total"] == 0 and body["invoices"]["total"] == 0
    assert body["needs_review"] == 0
    assert body["success_rate"] is None and body["failure_rate"] is None
    assert body["avg_processing_seconds"] is None and body["avg_stage_ms"] == {}


@pytest.mark.parametrize(
    "query",
    [
        "",
        "?date_from=2026-01-01",
        "?date_to=2026-12-31",
        "?date_from=2026-01-01&date_to=2026-06-30",
    ],
)
def test_trends_on_an_empty_database(client, query):
    r = client.get(f"{API}/stats/trends{query}", headers=API_HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 0 and body["top_suppliers"] == [] and body["currencies"] == []


@pytest.mark.parametrize("mode", ["hybrid", "keyword", "semantic"])
def test_search_on_an_empty_database(client, mode):
    r = client.get(f"{API}/search", params={"q": "acme", "mode": mode}, headers=API_HEADERS)
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


@pytest.mark.parametrize("q", ["a", "acme", "INV-001", "100.50", "2026-01-01"])
def test_global_search_on_an_empty_database(client, q):
    r = client.get(f"{API}/search/global", params={"q": q}, headers=API_HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    for group in ("documents", "invoices", "suppliers", "archived"):
        assert body[group] == {"items": [], "more": False}


@pytest.mark.parametrize(
    "path",
    [
        f"/documents/{MISSING}",
        f"/documents/{MISSING}/events",
        f"/documents/{MISSING}/pages",
        f"/documents/{MISSING}/pages/1/image",
        f"/invoices/{MISSING}",
        f"/jobs/{MISSING}",
    ],
)
def test_a_missing_id_is_404_not_500(client, path):
    r = client.get(API + path, headers=API_HEADERS)
    assert r.status_code == 404, r.text
    assert r.headers["content-type"].startswith("application/problem+json")


def test_a_real_server_error_stays_a_500_with_a_request_id(app, client):
    def broken():
        raise RuntimeError("database exploded")
        yield  # pragma: no cover

    app.dependency_overrides[get_session] = broken
    r = client.get(f"{API}/documents", headers=API_HEADERS)
    assert r.status_code == 500
    body = r.json()
    assert body["detail"] == "Internal server error"  # nothing internal leaks
    assert "exploded" not in r.text
    assert len(body["request_id"]) == 12
    assert r.headers["x-request-id"] == body["request_id"]
