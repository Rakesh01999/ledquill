"""GET /documents, /documents/{id}/events, /jobs/{id} and the /invoices filters (FR-15, FR-18)."""

import uuid
from datetime import date

import pytest

from tests.conftest import API_HEADERS
from tests.helpers import seed_invoice

DOCS, INVOICES, JOBS = "/api/v1/documents", "/api/v1/invoices", "/api/v1/jobs"


def get(client, path, **params):
    return client.get(path, params=params, headers=API_HEADERS)


@pytest.fixture
def seeded(db_session):
    """Three invoices from three suppliers, currencies, dates and totals."""
    return {
        "acme": seed_invoice(db_session, supplier="Acme Supplies Ltd", number="INV-100"),
        "globex": seed_invoice(
            db_session,
            supplier="Globex Trading",
            number="INV-200",
            currency="EUR",
            invoice_date=date(2026, 10, 5),
            subtotal="200.00",
            tax="30.00",
            total="230.00",
            items=(("Printer toner", "200.00"),),
        ),
        "initech": seed_invoice(
            db_session,
            supplier="Initech LLC",
            number="INV-300",
            document_status="failed",
            invoice_date=date(2026, 8, 20),
            subtotal="5000.00",
            tax="0.00",
            total="5000.00",
            items=(("Consulting", "5000.00"),),
            file_type="xlsx",
        ),
    }


def numbers(response) -> list[str]:
    assert response.status_code == 200, response.text
    return sorted(i["invoice_number"] for i in response.json()["items"])


# --- auth and error shape -----------------------------------------------------------------


@pytest.mark.parametrize("path", [DOCS, f"{DOCS}/{uuid.uuid4()}/events", INVOICES, f"{JOBS}/x"])
def test_lists_require_the_api_key(client, path):
    r = client.get(path)
    assert r.status_code == 401 and r.headers["content-type"].startswith("application/problem+json")


# --- documents ----------------------------------------------------------------------------


def test_documents_list_is_paginated_newest_first(client, seeded):
    body = get(client, DOCS).json()
    assert body["total"] == 3 and body["limit"] == 25 and body["offset"] == 0
    assert len(body["items"]) == 3 and body["items"][0]["job_id"] is not None
    first = get(client, DOCS, limit=2).json()
    rest = get(client, DOCS, limit=2, offset=2).json()
    assert len(first["items"]) == 2 and len(rest["items"]) == 1 and first["total"] == 3
    ids = [d["id"] for d in first["items"] + rest["items"]]
    assert len(set(ids)) == 3


def test_documents_filter_by_status_and_file_type(client, seeded):
    assert get(client, DOCS, status="failed").json()["total"] == 1
    assert get(client, DOCS, status="completed").json()["total"] == 2
    assert get(client, DOCS, file_type="xlsx").json()["total"] == 1
    assert get(client, DOCS, status="failed", file_type="pdf").json()["total"] == 0


def test_documents_filter_by_invoice_supplier_currency_and_dates(client, seeded):
    assert get(client, DOCS, supplier="globex").json()["total"] == 1
    assert get(client, DOCS, currency="eur").json()["total"] == 1
    assert get(client, DOCS, date_from="2026-09-01", date_to="2026-09-30").json()["total"] == 1
    # all conditions must hold on the same invoice
    assert get(client, DOCS, supplier="acme", currency="EUR").json()["total"] == 0


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 101},
        {"offset": -1},
        {"status": "done"},
        {"file_type": "exe"},
        {"currency": "EURO"},
        {"date_from": "yesterday"},
    ],
)
def test_documents_bad_query_is_422_problem_json(client, params):
    r = get(client, DOCS, **params)
    assert r.status_code == 422 and r.headers["content-type"].startswith("application/problem+json")
    assert r.json()["errors"]


def test_document_detail_events_and_job(client, db_session, seeded):
    doc_id = seeded["acme"].document_id
    detail = get(client, f"{DOCS}/{doc_id}").json()
    assert detail["status"] == "completed" and detail["job_id"]
    job = get(client, f"{JOBS}/{detail['job_id']}")
    assert job.status_code == 200
    assert job.json()["document_id"] == str(doc_id) and job.json()["kind"] == "process"
    assert job.json()["attempts"] == 1 and job.json()["finished_at"]
    events = get(client, f"{DOCS}/{doc_id}/events").json()
    assert events == {"items": [], "total": 0, "limit": 25, "offset": 0}


def test_events_list_stage_timings_in_order(client, db_session, seeded):
    from app.db.models import Job, ProcessingEvent

    doc_id = seeded["acme"].document_id
    job = db_session.query(Job).filter_by(document_id=doc_id).one()
    for stage, status, ms in (("detect", "started", None), ("detect", "succeeded", 12)):
        db_session.add(
            ProcessingEvent(
                document_id=doc_id, job_id=job.id, stage=stage, status=status, duration_ms=ms
            )
        )
    db_session.commit()
    items = get(client, f"{DOCS}/{doc_id}/events").json()["items"]
    assert [(e["stage"], e["status"], e["duration_ms"]) for e in items] == [
        ("detect", "started", None),
        ("detect", "succeeded", 12),
    ]
    assert get(client, f"{DOCS}/{doc_id}/events", limit=1).json()["total"] == 2


def test_unknown_document_events_and_job_are_404(client):
    for path in (
        f"{DOCS}/{uuid.uuid4()}",
        f"{DOCS}/{uuid.uuid4()}/events",
        f"{JOBS}/{uuid.uuid4()}",
    ):
        r = get(client, path)
        assert r.status_code == 404 and r.headers["content-type"].startswith("application/problem")
    assert get(client, f"{JOBS}/not-a-uuid").status_code == 422


# --- invoices -----------------------------------------------------------------------------


def test_invoice_list_without_filters_returns_everything_newest_first(client, seeded):
    body = get(client, INVOICES).json()
    assert body["total"] == 3 and [i["invoice_number"] for i in body["items"]][0] == "INV-300"
    assert body["items"][0]["total"] == "5000.00"  # money is a string


def test_invoice_filters(client, seeded):
    assert numbers(get(client, INVOICES, supplier="Acme")) == ["INV-100"]
    assert numbers(get(client, INVOICES, supplier="acme supplies")) == ["INV-100"]
    assert numbers(get(client, INVOICES, supplier="Acme Suplies")) == ["INV-100"]  # typo
    assert numbers(get(client, INVOICES, invoice_number="inv-200")) == ["INV-200"]
    assert numbers(get(client, INVOICES, currency="eur")) == ["INV-200"]
    assert numbers(get(client, INVOICES, date_from="2026-09-01")) == ["INV-100", "INV-200"]
    assert numbers(get(client, INVOICES, date_to="2026-09-01")) == ["INV-100", "INV-300"]
    assert numbers(get(client, INVOICES, min_total="1000", max_total="2000")) == ["INV-100"]
    assert numbers(get(client, INVOICES, min_total="230.00", max_total="230.00")) == ["INV-200"]
    assert numbers(get(client, INVOICES, status="ready")) == ["INV-100", "INV-200", "INV-300"]
    assert numbers(get(client, INVOICES, status="approved")) == []
    assert numbers(get(client, INVOICES, q="toner")) == ["INV-200"]
    assert numbers(get(client, INVOICES, q="INV-300")) == ["INV-300"]
    assert numbers(get(client, INVOICES, supplier="Initech", currency="EUR")) == []


def test_supplier_filter_treats_like_wildcards_literally(client, seeded):
    assert numbers(get(client, INVOICES, supplier="%")) == []
    assert numbers(get(client, INVOICES, supplier="_")) == []


def test_invoice_list_for_one_document_keeps_the_404_and_combines_with_filters(client, seeded):
    doc = str(seeded["acme"].document_id)
    assert numbers(get(client, INVOICES, document_id=doc)) == ["INV-100"]
    assert numbers(get(client, INVOICES, document_id=doc, currency="EUR")) == []
    assert get(client, INVOICES, document_id=str(uuid.uuid4())).status_code == 404


def test_invoice_list_is_paginated(client, seeded):
    page = get(client, INVOICES, limit=2, offset=2).json()
    assert page["total"] == 3 and len(page["items"]) == 1 and page["offset"] == 2


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 101},
        {"min_total": "abc"},
        {"min_total": "1.234"},
        {"currency": "US"},
        {"status": "bogus"},
        {"date_to": "2026-13-01"},
        {"q": ""},
        {"document_id": "x"},
    ],
)
def test_invoice_filter_validation_is_422(client, params):
    r = get(client, INVOICES, **params)
    assert r.status_code == 422 and r.headers["content-type"].startswith("application/problem+json")


def test_contradictory_ranges_are_422_not_an_empty_page(client, seeded):
    for path, params in (
        (INVOICES, {"date_from": "2026-10-01", "date_to": "2026-09-01"}),
        (INVOICES, {"min_total": "500", "max_total": "100"}),
        (DOCS, {"date_from": "2026-10-01", "date_to": "2026-09-01"}),
    ):
        r = get(client, path, **params)
        assert r.status_code == 422 and r.headers["content-type"].startswith("application/problem")
    assert get(client, INVOICES, min_total="100", max_total="100").status_code == 200  # equal is ok
