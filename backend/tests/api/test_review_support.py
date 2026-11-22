"""Backend support for the review UI: page text and images, document counts, severity sort."""

import uuid
from pathlib import Path

from tests.conftest import API_HEADERS
from tests.helpers import create_document, seed_invoice

DOCS, INVOICES = "/api/v1/documents", "/api/v1/invoices"
FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def get(client, path, **params):
    return client.get(path, params=params, headers=API_HEADERS)


def add_pages(session, document, texts):
    from app.db.models import Page

    for n, text in enumerate(texts, 1):
        session.add(Page(document_id=document.id, page_no=n, method="text", text=text))
    session.commit()


def test_pages_and_image_require_the_api_key(client):
    doc_id = uuid.uuid4()
    assert client.get(f"{DOCS}/{doc_id}/pages").status_code == 401
    assert client.get(f"{DOCS}/{doc_id}/pages/1/image").status_code == 401


def test_pages_lists_text_in_page_order(client, db_session):
    document, _ = create_document(db_session, FIXTURES / "digital.pdf")
    add_pages(db_session, document, ["first page", "second page"])
    body = get(client, f"{DOCS}/{document.id}/pages").json()
    assert body["total"] == 2
    assert [p["text"] for p in body["items"]] == ["first page", "second page"]
    assert [p["page_no"] for p in body["items"]] == [1, 2]
    assert all(p["has_image"] for p in body["items"])


def test_pages_of_unknown_document_is_404(client):
    assert get(client, f"{DOCS}/{uuid.uuid4()}/pages").status_code == 404


def test_page_image_is_a_png_for_a_pdf(client, db_session):
    document, _ = create_document(db_session, FIXTURES / "digital.pdf")
    add_pages(db_session, document, ["page one"])
    r = get(client, f"{DOCS}/{document.id}/pages/1/image")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")


def test_page_image_is_a_png_for_an_image_file(client, db_session):
    document, _ = create_document(db_session, FIXTURES / "scanned.png")
    add_pages(db_session, document, ["scan text"])
    r = get(client, f"{DOCS}/{document.id}/pages/1/image")
    assert r.status_code == 200 and r.content.startswith(b"\x89PNG")


def test_page_image_404_for_spreadsheet_and_missing_page(client, db_session):
    sheet, _ = create_document(db_session, FIXTURES / "two_sheets.xlsx")
    add_pages(db_session, sheet, ["a", "b"])
    assert get(client, f"{DOCS}/{sheet.id}/pages").json()["items"][0]["has_image"] is False
    assert get(client, f"{DOCS}/{sheet.id}/pages/1/image").status_code == 404
    pdf, _ = create_document(db_session, FIXTURES / "digital.pdf")
    add_pages(db_session, pdf, ["only"])
    assert get(client, f"{DOCS}/{pdf.id}/pages/2/image").status_code == 404
    assert get(client, f"{DOCS}/{pdf.id}/pages/0/image").status_code == 422


def test_document_counts_invoices_and_issues(client, db_session):
    clean = seed_invoice(db_session, number="OK-1")
    bad = seed_invoice(db_session, number="BAD-1", total="9999.00")
    empty, _ = create_document(db_session, FIXTURES / "digital.pdf")
    one = get(client, f"{DOCS}/{clean.document_id}").json()
    assert (one["invoice_count"], one["issue_count"]) == (1, 0)
    listed = {d["id"]: d for d in get(client, DOCS).json()["items"]}
    assert listed[str(bad.document_id)]["invoice_count"] == 1
    assert listed[str(bad.document_id)]["issue_count"] >= 1
    assert (listed[str(empty.id)]["invoice_count"], listed[str(empty.id)]["issue_count"]) == (0, 0)


def test_severity_sort_orders_errors_warnings_low_confidence_then_clean(client, db_session):
    low_conf = {k: 0.5 for k in ("invoice_number", "invoice_date", "supplier_name", "total")}
    full = {
        k: 1.0
        for k in (
            "invoice_number",
            "invoice_date",
            "supplier_name",
            "customer_name",
            "currency",
            "subtotal",
            "tax",
            "total",
        )
    }
    seed_invoice(db_session, number="CLEAN", confidence=full)
    seed_invoice(db_session, number="LOWCONF", confidence={**full, **low_conf})
    seed_invoice(db_session, number="ERR-NEW", total="9999.00", confidence=full)
    seed_invoice(db_session, number="ERR-OLD", total="8888.00", confidence=full)
    body = get(client, INVOICES, sort="severity").json()
    order = [i["invoice_number"] for i in body["items"]]
    # Oldest error first inside the error group would put ERR-NEW before ERR-OLD (seeded first).
    assert order[:2] == ["ERR-NEW", "ERR-OLD"]
    assert order[-2:] == ["LOWCONF", "CLEAN"]


def test_severity_sort_respects_filters_and_pagination(client, db_session):
    seed_invoice(db_session, number="E1", total="9999.00")
    seed_invoice(db_session, number="E2", total="7777.00")
    body = get(client, INVOICES, sort="severity", status="needs_review", limit=1, offset=1).json()
    assert body["total"] == 2 and len(body["items"]) == 1
    assert get(client, INVOICES, sort="bogus").status_code == 422
