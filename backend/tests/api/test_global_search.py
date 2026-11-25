"""GET /search/global: documents, invoices, suppliers and archived items in one box."""

import uuid
from datetime import date

import pytest

from tests.conftest import API_HEADERS
from tests.helpers import seed_invoice

URL = "/api/v1/search/global"
INVOICES = "/api/v1/invoices"


def find(client, q, **params):
    r = client.get(URL, params={"q": q, **params}, headers=API_HEADERS)
    assert r.status_code == 200, r.text
    return r.json()


def numbers(body):
    return [i["invoice_number"] for i in body["invoices"]["items"]]


@pytest.fixture
def seeded(db_session):
    def add(supplier, number, **kw):
        return seed_invoice(db_session, supplier=supplier, number=number, **kw)

    return {
        "acme1": add(
            "Acme Supplies Ltd",
            "INV-2970",
            total="2970.00",
            subtotal="2970.00",
            tax="0.00",
            items=(("Chairs", "2970.00"),),
            invoice_date=date(2026, 9, 1),
        ),
        "acme2": add(
            "Acme Supplies Ltd",
            "INV-2970-B",
            total="2970.50",
            subtotal="2970.50",
            tax="0.00",
            items=(("Desks", "2970.50"),),
            invoice_date=date(2026, 9, 2),
        ),
        "globex": add("Globex Trading", "GX-100", currency="EUR", invoice_date=date(2026, 8, 1)),
        "odd": add("100% Natural_Foods O'Brien", "ODD-1"),
    }


def test_requires_the_api_key_and_a_real_query(client):
    assert client.get(URL, params={"q": "x"}).status_code == 401
    for q in ("", "   "):
        assert client.get(URL, params={"q": q}, headers=API_HEADERS).status_code == 422
    assert client.get(URL, params={"q": "x" * 201}, headers=API_HEADERS).status_code == 422
    assert client.get(URL, params={"q": "x", "limit": 11}, headers=API_HEADERS).status_code == 422


def test_empty_database_and_no_match_give_four_empty_groups(client, seeded):
    body = find(client, "zzzz-nothing")
    for group in ("documents", "invoices", "suppliers", "archived"):
        assert body[group] == {"items": [], "more": False}


def test_matches_invoice_number_supplier_and_ranks_exact_first(client, seeded):
    body = find(client, "inv-2970")
    assert numbers(body)[0] == "INV-2970"  # exact number before the one that only starts with it
    assert set(numbers(body)) == {"INV-2970", "INV-2970-B"}
    by_supplier = find(client, "globex")
    assert numbers(by_supplier) == ["GX-100"]
    assert by_supplier["suppliers"]["items"] == [{"supplier": "Globex Trading", "count": 1}]


def test_suppliers_group_has_exact_names_with_live_counts(client, seeded):
    body = find(client, "acme")
    assert body["suppliers"]["items"] == [{"supplier": "Acme Supplies Ltd", "count": 2}]


@pytest.mark.parametrize(
    ("q", "expected"),
    [
        ("2970", {"INV-2970", "INV-2970-B"}),  # whole number: both totals start with it
        ("2,970.00", {"INV-2970"}),  # thousands separator and decimals
        ("2 970.50", {"INV-2970-B"}),
        ("$2970.5", {"INV-2970-B"}),
    ],
)
def test_amounts_are_understood(client, seeded, q, expected):
    assert set(numbers(find(client, q))) >= expected
    assert expected <= set(numbers(find(client, q)))


def test_short_numbers_are_not_treated_as_amounts(client, seeded):
    body = find(client, "29")  # would match every total starting with 29 if it were an amount
    assert "INV-2970" in numbers(body)  # still matches the invoice number text
    assert find(client, "11")["invoices"]["items"] == []


def test_currency_code_matches_and_ids_match_by_prefix(client, seeded):
    assert numbers(find(client, "eur")) == ["GX-100"]
    invoice_id = client.get(
        INVOICES, params={"supplier_exact": "Globex Trading"}, headers=API_HEADERS
    ).json()["items"][0]["id"]
    assert numbers(find(client, invoice_id[:8])) == ["GX-100"]
    assert numbers(find(client, invoice_id)) == ["GX-100"]
    assert find(client, invoice_id[:3])["invoices"]["items"] == []  # too short to be an id


def test_documents_match_file_name_and_id_prefix(client, db_session):
    one = seed_invoice(db_session, number="D-1")
    doc_id = str(one.document_id)
    body = find(client, doc_id[:8])
    assert [d["id"] for d in body["documents"]["items"]] == [doc_id]
    assert body["documents"]["items"][0]["filename"] == f"{doc_id}.pdf"
    assert find(client, ".pdf")["documents"]["items"][0]["id"] == doc_id


@pytest.mark.parametrize("q", ["100%", "Natural_Foods", "O'Brien", "%", "_"])
def test_special_characters_match_themselves_literally(client, seeded, q):
    # The seeded supplier really contains these characters, so they find it.
    assert numbers(find(client, q)) == ["ODD-1"]


@pytest.mark.parametrize(
    "q",
    [
        "A%d",
        "_atural",
        "N_tural",
        "Acme%Ltd",
        "'; DROP TABLE invoices;--",
        "\\",
        '"quoted"',
        "1=1 OR 1=1",
    ],
)
def test_wildcards_and_sql_text_are_not_interpreted(client, seeded, q):
    body = find(client, q)
    assert body["invoices"]["items"] == [] and body["suppliers"]["items"] == []
    assert client.get(INVOICES, headers=API_HEADERS).json()["total"] == 4  # the table is intact


def test_limit_is_per_group_and_more_says_so(client, db_session):
    for n in range(7):
        seed_invoice(db_session, supplier=f"Bulk Supplier {n}", number=f"BULK-{n}")
    body = find(client, "bulk", limit=3)
    assert len(body["invoices"]["items"]) == 3 and body["invoices"]["more"] is True
    assert len(body["suppliers"]["items"]) == 3 and body["suppliers"]["more"] is True
    everything = find(client, "bulk", limit=10)
    assert len(everything["invoices"]["items"]) == 7 and everything["invoices"]["more"] is False


def test_archived_items_are_in_their_own_group_and_never_in_the_live_ones(client, seeded):
    target = client.get(
        INVOICES, params={"supplier_exact": "Globex Trading"}, headers=API_HEADERS
    ).json()["items"][0]
    assert client.post(f"{INVOICES}/{target['id']}/archive", headers=API_HEADERS).status_code == 200
    body = find(client, "globex")
    assert body["invoices"]["items"] == [] and body["suppliers"]["items"] == []
    (hit,) = body["archived"]["items"]
    assert hit["kind"] == "invoice" and hit["title"] == "GX-100" and hit["id"] == target["id"]
    assert "Globex Trading" in hit["detail"] and hit["archived_at"]
    assert numbers(find(client, "inv-2970")) != []  # unrelated live results are untouched


def test_archived_documents_match_by_file_name(client, db_session):
    one = seed_invoice(db_session, number="ARC-1")
    doc = str(one.document_id)
    assert client.post(f"/api/v1/documents/{doc}/archive", headers=API_HEADERS).status_code == 200
    body = find(client, doc[:8])
    assert body["documents"]["items"] == []
    kinds = {(h["kind"], h["id"]) for h in body["archived"]["items"]}
    assert ("document", doc) in kinds


def test_unknown_id_prefix_returns_nothing(client, seeded):
    assert find(client, str(uuid.uuid4())[:12])["invoices"]["items"] == []
