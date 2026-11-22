"""PATCH /invoices/{id} and POST /invoices/{id}/approve (FR-15, FR-21, FR-13)."""

import uuid

import pytest

from app.db.models import Correction
from tests.conftest import API_HEADERS
from tests.helpers import seed_invoice

INVOICES = "/api/v1/invoices"


def patch(client, invoice_id, body):
    return client.patch(f"{INVOICES}/{invoice_id}", json=body, headers=API_HEADERS)


def approve(client, invoice_id):
    return client.post(f"{INVOICES}/{invoice_id}/approve", headers=API_HEADERS)


def rules(body) -> list[str]:
    return sorted(i["rule_id"] for i in body["issues"])


@pytest.fixture
def clean(db_session):
    return seed_invoice(db_session)  # all rules pass: status ready


@pytest.fixture
def broken(db_session):
    """total 1200 but 1000 + 150 = 1150: V-05 is an error."""
    return seed_invoice(db_session, total="1200.00")


# --- PATCH --------------------------------------------------------------------------------


def test_patch_fixes_the_total_logs_the_change_and_revalidates(client, broken):
    assert broken.status == "needs_review"
    r = patch(client, broken.id, {"total": "1150.00", "note": "typo on the scan"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == "1150.00" and isinstance(body["total"], str)
    assert body["issues"] == [] and body["status"] == "ready"  # re-validated
    assert body["corrected_fields"] == ["total"]
    assert body["confidence"]["total"] == 1.0
    (c,) = body["corrections"]
    assert (c["field"], c["old_value"], c["new_value"], c["note"]) == (
        "total",
        "1200.00",
        "1150.00",
        "typo on the scan",
    )
    assert c["created_at"]


def test_patch_that_creates_a_problem_raises_the_issue(client, clean):
    body = patch(client, clean.id, {"total": "1200.00"}).json()
    assert rules(body) == ["V-05"] and body["status"] == "needs_review"
    assert body["corrected_fields"] == ["total"]


def test_patch_several_fields_writes_one_correction_per_changed_field(client, clean):
    body = patch(
        client,
        clean.id,
        {
            "supplier_name": "Acme Supplies Limited",
            "invoice_date": "2026-09-02",
            "currency": "eur",
            "customer_name": "Globex Corp",  # unchanged: not logged
        },
    ).json()
    assert body["corrected_fields"] == ["currency", "invoice_date", "supplier_name"]
    assert body["currency"] == "EUR" and body["invoice_date"] == "2026-09-02"
    old_new = {c["field"]: (c["old_value"], c["new_value"]) for c in body["corrections"]}
    assert old_new["invoice_date"] == ("2026-09-01", "2026-09-02")
    assert old_new["currency"] == ("USD", "EUR")


def test_patch_with_the_same_values_changes_nothing(client, db_session, clean):
    r = patch(client, clean.id, {"total": "1150.00", "invoice_number": "INV-1"})
    assert r.status_code == 200
    assert r.json()["corrections"] == [] and r.json()["corrected_fields"] == []
    assert db_session.query(Correction).count() == 0


def test_patch_null_clears_a_field_and_raises_v01(client, clean):
    body = patch(client, clean.id, {"supplier_name": None}).json()
    assert body["supplier_name"] is None
    assert "V-01" in rules(body) and body["status"] == "needs_review"
    assert body["corrections"][0]["old_value"] == "Acme Supplies Ltd"
    assert body["corrections"][0]["new_value"] is None


def test_patch_replaces_line_items_and_logs_them_as_one_correction(client, broken):
    body = patch(
        client,
        broken.id,
        {
            "line_items": [
                {
                    "description": "A4 paper",
                    "quantity": "10",
                    "unit_price": "100.00",
                    "amount": "900.00",
                },
                {
                    "description": "Toner",
                    "quantity": "1",
                    "unit_price": "100.00",
                    "amount": "100.00",
                },
            ],
            "total": "1150.00",
        },
    ).json()
    assert [i["line_no"] for i in body["line_items"]] == [1, 2]
    assert body["line_items"][0]["amount"] == "900.00"
    assert body["line_items"][0]["quantity"] == "10.0000"
    assert body["corrected_fields"] == ["line_items", "total"]
    assert "V-05" not in rules(body)


def test_patch_updates_what_search_reads(client, clean):
    patch(client, clean.id, {"supplier_name": "Zenith Partners"})
    found = client.get(INVOICES, params={"q": "zenith"}, headers=API_HEADERS).json()
    assert [i["id"] for i in found["items"]] == [str(clean.id)]
    assert client.get(INVOICES, params={"q": "acme"}, headers=API_HEADERS).json()["total"] == 0


def test_editing_an_approved_invoice_revokes_the_approval(client, clean):
    assert approve(client, clean.id).json()["status"] == "approved"
    body = patch(client, clean.id, {"invoice_number": "INV-1B"}).json()
    assert body["status"] == "ready"  # re-derived, no longer approved
    assert body["corrected_fields"] == ["invoice_number"]


def test_corrections_accumulate_across_patches(client, clean):
    patch(client, clean.id, {"total": "1200.00"})
    body = patch(client, clean.id, {"total": "1150.00"}).json()
    assert [(c["old_value"], c["new_value"]) for c in body["corrections"]] == [
        ("1150.00", "1200.00"),
        ("1200.00", "1150.00"),
    ]
    assert body["corrected_fields"] == ["total"]  # listed once
    detail = client.get(f"{INVOICES}/{clean.id}", headers=API_HEADERS).json()
    assert detail["corrected_fields"] == ["total"] and len(detail["corrections"]) == 2


def test_patch_unknown_invoice_is_404_problem_json(client):
    r = patch(client, uuid.uuid4(), {"total": "1.00"})
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/problem+json")


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"note": "only a note"},
        {"total": 1150.0},  # a JSON number is a float: refused
        {"total": 1150},
        {"total": "abc"},
        {"total": "NaN"},
        {"total": "1.234"},
        {"total": "12345678901234567890"},
        {"subtotal": True},
        {"invoice_date": "not a date"},
        {"invoice_date": "2026-02-30"},
        {"invoice_date": 1700000000},
        {"currency": "US"},
        {"currency": "USDX"},
        {"currency": "12$"},
        {"invoice_number": ""},
        {"invoice_number": "x" * 201},
        {"line_items": None},
        {"line_items": [{"amount": 12.5}]},
        {"line_items": [{"bogus": "x"}]},
        {"status": "approved"},  # not a correctable field
        {"confidence": {"total": 1.0}},
        {"id": str(uuid.uuid4())},
    ],
)
def test_invalid_corrections_are_422_and_change_nothing(client, db_session, clean, body):
    r = patch(client, clean.id, body)
    assert r.status_code == 422, r.text
    assert r.headers["content-type"].startswith("application/problem+json")
    assert r.json()["errors"]
    assert db_session.query(Correction).count() == 0
    detail = client.get(f"{INVOICES}/{clean.id}", headers=API_HEADERS).json()
    assert detail["total"] == "1150.00" and detail["status"] == "ready"


def test_bad_invoice_id_is_422_and_missing_key_is_401(client, clean):
    assert patch(client, "nope", {"total": "1.00"}).status_code == 422
    r = client.patch(f"{INVOICES}/{clean.id}", json={"total": "1.00"})
    assert r.status_code == 401


# --- approve ------------------------------------------------------------------------------


def test_approve_a_clean_invoice(client, clean):
    r = approve(client, clean.id)
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert client.get(f"{INVOICES}/{clean.id}", headers=API_HEADERS).json()["status"] == "approved"


def test_approve_is_idempotent(client, clean):
    approve(client, clean.id)
    again = approve(client, clean.id)
    assert again.status_code == 200 and again.json()["status"] == "approved"


def test_approve_is_blocked_by_an_error_issue(client, broken):
    r = approve(client, broken.id)
    assert r.status_code == 409 and r.headers["content-type"].startswith("application/problem+json")
    assert "V-05" in r.json()["detail"] and r.json()["blocking_rules"] == ["V-05"]
    assert client.get(f"{INVOICES}/{broken.id}", headers=API_HEADERS).json()["status"] != "approved"


def test_approve_after_fixing_the_error_works(client, broken):
    assert approve(client, broken.id).status_code == 409
    patch(client, broken.id, {"total": "1150.00"})
    assert approve(client, broken.id).json()["status"] == "approved"


def test_a_warning_alone_does_not_block_approval(client, db_session):
    low = seed_invoice(db_session, confidence={"invoice_number": 0.3})  # V-08 warnings
    detail = client.get(f"{INVOICES}/{low.id}", headers=API_HEADERS).json()
    assert detail["status"] == "needs_review"
    assert {i["severity"] for i in detail["issues"]} == {"warning"}
    assert approve(client, low.id).json()["status"] == "approved"


def test_approve_unknown_invoice_is_404_and_needs_the_key(client, clean):
    assert approve(client, uuid.uuid4()).status_code == 404
    assert approve(client, "nope").status_code == 422
    assert client.post(f"{INVOICES}/{clean.id}/approve").status_code == 401


# --- other invoices affected by a correction ----------------------------------------------------


def test_correcting_the_number_clears_the_duplicate_flag_on_the_sibling(client, db_session):
    first = seed_invoice(db_session, number="INV-10")
    second = seed_invoice(db_session, number="INV-10")  # same supplier and number: duplicate
    flagged = client.get(f"{INVOICES}/{second.id}", headers=API_HEADERS).json()
    assert "V-07" in rules(flagged) and flagged["status"] == "needs_review"

    patch(client, first.id, {"invoice_number": "INV-11"})
    sibling = client.get(f"{INVOICES}/{second.id}", headers=API_HEADERS).json()
    assert "V-07" not in rules(sibling) and sibling["status"] == "ready"


def test_correcting_into_a_duplicate_flags_both_invoices(client, db_session):
    first = seed_invoice(db_session, number="INV-20")
    second = seed_invoice(db_session, number="INV-21")
    patch(client, first.id, {"invoice_number": "INV-21"})
    for invoice in (first, second):
        body = client.get(f"{INVOICES}/{invoice.id}", headers=API_HEADERS).json()
        assert "V-07" in rules(body), invoice.invoice_number


def test_revalidating_a_sibling_keeps_its_approval(client, db_session):
    first = seed_invoice(db_session, number="INV-30")
    second = seed_invoice(db_session, number="INV-31")
    approve(client, second.id)
    patch(client, first.id, {"invoice_number": "INV-31"})  # second now has a duplicate
    body = client.get(f"{INVOICES}/{second.id}", headers=API_HEADERS).json()
    assert "V-07" in rules(body) and body["status"] == "approved"  # a human decision stands
