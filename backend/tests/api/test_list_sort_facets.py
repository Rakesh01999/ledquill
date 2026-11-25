"""GET /invoices/facets, column sorts and repeated filter values (additive to FR-18)."""

from datetime import date

import pytest

from tests.conftest import API_HEADERS
from tests.helpers import seed_invoice

INVOICES = "/api/v1/invoices"


def get(client, path, **params):
    params = {k: v for k, v in params.items() if v is not None}
    return client.get(path, params=params, headers=API_HEADERS)


@pytest.fixture
def seeded(db_session):
    seed = seed_invoice
    seed(
        db_session,
        supplier="Acme Supplies Ltd",
        number="b-200",
        currency="USD",
        invoice_date=date(2026, 9, 1),
        total="1150.00",
    )
    seed(
        db_session,
        supplier="acme supplies ltd",
        number="A-100",
        currency="USD",
        invoice_date=date(2026, 7, 1),
        total="50.00",
        subtotal="43.48",
        tax="6.52",
        items=(("Pens", "43.48"),),
    )
    seed(
        db_session,
        supplier="Globex Trading",
        number="C-300",
        currency="EUR",
        invoice_date=date(2026, 10, 5),
        total="9000.00",
        subtotal="9000.00",
        tax="0.00",
        items=(("Consulting", "9000.00"),),
    )
    seed(
        db_session,
        supplier=None,
        number=None,
        currency=None,
        invoice_date=None,
        total=None,
        subtotal=None,
        tax=None,
        items=(),
    )


def values(response, key):
    assert response.status_code == 200, response.text
    return [i[key] for i in response.json()["items"]]


# --- facets ---------------------------------------------------------------------------------


def test_facets_list_suppliers_and_currencies_with_counts(client, seeded):
    body = get(client, f"{INVOICES}/facets").json()
    assert {(f["value"], f["count"]) for f in body["suppliers"]} == {
        ("Acme Supplies Ltd", 1),
        ("acme supplies ltd", 1),
        ("Globex Trading", 1),
    }
    assert {(f["value"], f["count"]) for f in body["currencies"]} == {("USD", 2), ("EUR", 1)}
    assert body["currencies"][0] == {"value": "USD", "count": 2}  # most invoices first


def test_facets_narrow_and_cap_suppliers(client, seeded):
    narrowed = get(client, f"{INVOICES}/facets", q="glob").json()
    assert [f["value"] for f in narrowed["suppliers"]] == ["Globex Trading"]
    assert len(get(client, f"{INVOICES}/facets", limit=1).json()["suppliers"]) == 1
    assert get(client, f"{INVOICES}/facets", q="100%").json()["suppliers"] == []  # literal %


def test_facets_leave_out_archived_invoices_unless_asked(client, seeded):
    invoice_id = get(client, INVOICES, supplier="Globex").json()["items"][0]["id"]
    assert client.post(f"{INVOICES}/{invoice_id}/archive", headers=API_HEADERS).status_code == 200
    live = get(client, f"{INVOICES}/facets").json()
    assert "Globex Trading" not in [f["value"] for f in live["suppliers"]]
    assert "EUR" not in [f["value"] for f in live["currencies"]]
    gone = get(client, f"{INVOICES}/facets", archived=True).json()
    assert [f["value"] for f in gone["suppliers"]] == ["Globex Trading"]


def test_facets_require_the_api_key_and_validate_limit(client):
    assert client.get(f"{INVOICES}/facets").status_code == 401
    assert get(client, f"{INVOICES}/facets", limit=0).status_code == 422


# --- sort -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sort", "order", "expected"),
    [
        ("number", None, ["A-100", "b-200", "C-300", None]),  # case-insensitive, empty last
        ("number", "desc", ["C-300", "b-200", "A-100", None]),
        ("total", None, ["9000.00", "1150.00", "50.00", None]),  # amounts: biggest first
        ("total", "asc", ["50.00", "1150.00", "9000.00", None]),
        ("date", None, ["2026-07-01", "2026-09-01", "2026-10-05", None]),
        ("date", "desc", ["2026-10-05", "2026-09-01", "2026-07-01", None]),
    ],
)
def test_column_sorts(client, seeded, sort, order, expected):
    key = {"number": "invoice_number", "total": "total", "date": "invoice_date"}[sort]
    assert values(get(client, INVOICES, sort=sort, order=order), key) == expected


def test_supplier_and_issue_sorts(client, seeded):
    by_supplier = values(get(client, INVOICES, sort="supplier"), "supplier_name")
    assert by_supplier[-1] is None
    assert [s.lower() for s in by_supplier[:-1]] == sorted(s.lower() for s in by_supplier[:-1])
    issues = [len(i["issues"]) for i in get(client, INVOICES, sort="issues").json()["items"]]
    assert issues == sorted(issues, reverse=True)
    status = values(get(client, INVOICES, sort="status", order="desc"), "status")
    assert status == sorted(status, reverse=True)


def test_default_order_and_unknown_sort(client, seeded):
    assert get(client, INVOICES).status_code == 200  # still newest first
    assert get(client, INVOICES, sort="bogus").status_code == 422
    assert get(client, INVOICES, sort="total", order="sideways").status_code == 422


def test_sort_pages_do_not_overlap(client, seeded):
    first = values(get(client, INVOICES, sort="total", limit=2, offset=0), "id")
    second = values(get(client, INVOICES, sort="total", limit=2, offset=2), "id")
    assert len(set(first + second)) == 4


# --- repeated filter values ---------------------------------------------------------------


def test_repeated_currency_and_status_values(client, seeded):
    both = client.get(f"{INVOICES}?currency=usd&currency=EUR", headers=API_HEADERS)
    assert len(both.json()["items"]) == 3
    one = client.get(f"{INVOICES}?currency=EUR", headers=API_HEADERS)  # a single value still works
    assert values(one, "invoice_number") == ["C-300"]
    states = client.get(f"{INVOICES}?status=needs_review&status=approved", headers=API_HEADERS)
    assert states.status_code == 200
    assert (
        client.get(f"{INVOICES}?status=ready&status=nope", headers=API_HEADERS).status_code == 422
    )
    assert (
        client.get(f"{INVOICES}?currency=USD&currency=EURO", headers=API_HEADERS).status_code == 422
    )


def test_repeated_supplier_values_match_any(client, seeded):
    r = client.get(f"{INVOICES}?supplier=Globex&supplier=Acme", headers=API_HEADERS)
    assert len(r.json()["items"]) == 3
    only = client.get(f"{INVOICES}?supplier=Globex", headers=API_HEADERS)
    assert values(only, "invoice_number") == ["C-300"]


def test_supplier_exact_matches_whole_names_only(client, db_session, seeded):
    seed_invoice(db_session, supplier="Acme Supplies Ltd Holdings", number="D-400")
    fuzzy = client.get(f"{INVOICES}?supplier=Acme Supplies Ltd", headers=API_HEADERS)
    assert "D-400" in values(fuzzy, "invoice_number")  # the old filter is a substring match
    exact = client.get(f"{INVOICES}?supplier_exact=Acme Supplies Ltd", headers=API_HEADERS)
    assert values(exact, "invoice_number") == ["b-200"]  # only that exact name (case-sensitive)
    two = client.get(
        f"{INVOICES}?supplier_exact=Acme Supplies Ltd&supplier_exact=Globex Trading",
        headers=API_HEADERS,
    )
    assert sorted(values(two, "invoice_number")) == ["C-300", "b-200"]
    assert client.get(f"{INVOICES}?supplier_exact=Nobody", headers=API_HEADERS).json()["total"] == 0
