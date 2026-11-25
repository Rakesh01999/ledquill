"""GET /stats/trends: invoices over time, top suppliers and the currency split."""

from datetime import date
from decimal import Decimal

import pytest

from tests.conftest import API_HEADERS
from tests.helpers import seed_invoice

URL = "/api/v1/stats/trends"
INVOICES = "/api/v1/invoices"


def trends(client, **params):
    r = client.get(URL, params=params, headers=API_HEADERS)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def seeded(db_session):
    def add(supplier, number, day, currency="USD", total="110.00", subtotal="100.00", tax="10.00"):
        return seed_invoice(
            db_session,
            supplier=supplier,
            number=number,
            invoice_date=day,
            currency=currency,
            subtotal=subtotal,
            tax=tax,
            total=total,
            items=(("Item", subtotal),),
        )

    add("Acme Supplies Ltd", "A-1", date(2026, 1, 5))
    add(
        "Acme Supplies Ltd",
        "A-2",
        date(2026, 1, 20),
        total="220.00",
        subtotal="200.00",
        tax="20.00",
    )
    add("Globex Trading", "G-1", date(2026, 3, 2), currency="EUR")
    add(
        "Acme Supplies Ltd",
        "A-3",
        date(2026, 3, 15),
        currency="EUR",
        total="55.00",
        subtotal="50.00",
        tax="5.00",
    )
    add("Initech LLC", "I-1", date(2026, 3, 16))
    seed_invoice(
        db_session,
        supplier=None,
        number="N-1",
        invoice_date=None,
        currency=None,
        total=None,
        subtotal=None,
        tax=None,
        items=(),
    )


def test_requires_the_api_key(client):
    assert client.get(URL).status_code == 401


def test_empty_database_gives_empty_but_well_formed_answer(client):
    body = trends(client)
    assert body["total"] == 0 and body["series"] == [] and body["top_suppliers"] == []
    assert body["currencies"] == [] and body["by_status"] == {
        "needs_review": 0,
        "ready": 0,
        "approved": 0,
    }
    assert body["range_start"] is None and body["bucket"] == "month"


def test_all_time_counts_totals_and_undated(client, seeded):
    body = trends(client)
    assert body["total"] == 6 and body["undated"] == 1 and body["unknown_currency"] == 1
    assert sum(body["by_status"].values()) == 6
    assert (body["range_start"], body["range_end"]) == ("2026-01-05", "2026-03-16")
    assert body["bucket"] == "week"  # a 70-day span


def test_series_has_one_point_per_bucket_including_empty_ones(client, seeded):
    body = trends(client, date_from="2026-01-01", date_to="2026-03-31")
    assert body["bucket"] == "week"
    periods = [p["period"] for p in body["series"]]
    assert periods[0] == "2025-12-29"  # the Monday of the week holding 1 Jan
    assert all(date.fromisoformat(p).weekday() == 0 for p in periods)
    assert sum(p["count"] for p in body["series"]) == 5
    assert any(p["count"] == 0 for p in body["series"])  # February is empty


def test_small_and_large_ranges_choose_day_and_month_buckets(client, seeded):
    days = trends(client, date_from="2026-03-01", date_to="2026-03-31")
    assert days["bucket"] == "day" and len(days["series"]) == 31
    assert [p["count"] for p in days["series"] if p["count"]] == [1, 1, 1]
    months = trends(client, date_from="2025-06-01", date_to="2026-12-31")
    assert months["bucket"] == "month" and months["series"][0]["period"] == "2025-06-01"
    assert [p["count"] for p in months["series"] if p["count"]] == [2, 3]


def test_range_narrows_every_number_and_ignores_undated(client, seeded):
    body = trends(client, date_from="2026-03-01", date_to="2026-03-31")
    assert body["total"] == 3 and body["undated"] == 0 and body["unknown_currency"] == 0
    assert {s["supplier"] for s in body["top_suppliers"]} == {
        "Globex Trading",
        "Acme Supplies Ltd",
        "Initech LLC",
    }
    assert body["date_from"] == "2026-03-01" and body["date_to"] == "2026-03-31"


def test_top_suppliers_are_exact_names_by_count_with_per_currency_amounts(client, seeded):
    top = trends(client)["top_suppliers"]
    assert top[0]["supplier"] == "Acme Supplies Ltd" and top[0]["count"] == 3
    by_currency = {a["currency"]: Decimal(a["total"]) for a in top[0]["amounts"]}
    assert by_currency == {
        "EUR": Decimal("55.00"),
        "USD": Decimal("330.00"),
    }  # never added together
    # the same name drills down to exactly those invoices
    listed = client.get(f"{INVOICES}?supplier_exact=Acme Supplies Ltd", headers=API_HEADERS).json()
    assert listed["total"] == top[0]["count"]


def test_currency_split_matches_the_invoice_list(client, seeded):
    split = {c["currency"]: (c["count"], Decimal(c["total"])) for c in trends(client)["currencies"]}
    assert split == {"USD": (3, Decimal("440.00")), "EUR": (2, Decimal("165.00"))}
    listed = client.get(f"{INVOICES}?currency=USD", headers=API_HEADERS).json()
    assert listed["total"] == 3


def test_range_count_matches_the_invoice_list_filter(client, seeded):
    body = trends(client, date_from="2026-01-01", date_to="2026-01-31")
    listed = client.get(f"{INVOICES}?date_from=2026-01-01&date_to=2026-01-31", headers=API_HEADERS)
    assert body["total"] == listed.json()["total"] == 2


def test_archived_invoices_are_left_out(client, seeded):
    first = client.get(
        INVOICES, params={"supplier_exact": "Globex Trading"}, headers=API_HEADERS
    ).json()["items"][0]
    assert client.post(f"{INVOICES}/{first['id']}/archive", headers=API_HEADERS).status_code == 200
    body = trends(client)
    assert body["total"] == 5
    assert "Globex Trading" not in [s["supplier"] for s in body["top_suppliers"]]


def test_a_range_with_no_invoices_still_answers(client, seeded):
    body = trends(client, date_from="2020-01-01", date_to="2020-01-10")
    assert body["total"] == 0 and body["top_suppliers"] == [] and body["currencies"] == []
    assert len(body["series"]) == 10 and all(p["count"] == 0 for p in body["series"])


def test_reversed_range_is_422(client):
    r = client.get(
        URL, params={"date_from": "2026-02-01", "date_to": "2026-01-01"}, headers=API_HEADERS
    )
    assert r.status_code == 422
