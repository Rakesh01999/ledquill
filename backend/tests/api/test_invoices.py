import io
import uuid

from tests.conftest import API_HEADERS
from tests.fakes import llm_json
from tests.fixtures.builders import MISMATCH_LLM, mismatch_pdf

DOCS, INVOICES = "/api/v1/documents", "/api/v1/invoices"


def upload_mismatch(client, tmp_path) -> str:
    data = mismatch_pdf(tmp_path / "m.pdf").read_bytes()
    r = client.post(DOCS, files=[("files", ("m.pdf", io.BytesIO(data)))], headers=API_HEADERS)
    return r.json()["accepted"][0]["document_id"]


def test_endpoints_require_the_api_key(client):
    assert client.get(INVOICES, params={"document_id": str(uuid.uuid4())}).status_code == 401
    assert client.get(f"{INVOICES}/{uuid.uuid4()}").status_code == 401
    bad = {"X-API-Key": "wrong"}
    assert client.get(f"{INVOICES}/{uuid.uuid4()}", headers=bad).status_code == 401


def test_list_for_a_document_and_detail_return_fields_line_items_and_issues(
    client, fake_llm, tmp_path
):
    fake_llm.script(MISMATCH_LLM)
    document_id = upload_mismatch(client, tmp_path)
    listed = client.get(INVOICES, params={"document_id": document_id}, headers=API_HEADERS).json()
    assert listed["total"] == 1
    summary = listed["items"][0]
    detail = client.get(f"{INVOICES}/{summary['id']}", headers=API_HEADERS)
    assert detail.status_code == 200 and detail.json() == summary
    body = detail.json()
    assert body["document_id"] == document_id and body["invoice_number"] == "INV-5001"
    assert body["total"] == "1200.00" and isinstance(body["total"], str)  # Decimal, never float
    assert body["line_items"][0]["line_no"] == 1
    assert [i["rule_id"] for i in body["issues"]] == ["V-05"]


def test_unknown_document_or_invoice_is_404_problem_json(client):
    r = client.get(INVOICES, params={"document_id": str(uuid.uuid4())}, headers=API_HEADERS)
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/problem+json")
    assert client.get(f"{INVOICES}/{uuid.uuid4()}", headers=API_HEADERS).status_code == 404


def test_bad_ids_are_422(client):
    assert client.get(f"{INVOICES}/not-a-uuid", headers=API_HEADERS).status_code == 422
    assert client.get(INVOICES, params={"document_id": "x"}, headers=API_HEADERS).status_code == 422


def test_confidence_and_status_are_exposed(client, fake_llm, tmp_path):
    fake_llm.script(llm_json(invoice_number="INV-5001", total=1200.0))
    document_id = upload_mismatch(client, tmp_path)
    (inv,) = client.get(INVOICES, params={"document_id": document_id}, headers=API_HEADERS).json()[
        "items"
    ]
    assert inv["status"] == "needs_review" and inv["confidence"]["invoice_number"] == 0.95
