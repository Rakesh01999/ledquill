"""Archive and restore of documents and invoices: nothing is deleted, archived rows leave every
list, the stats, the review queue, search and the duplicate rules, and come back on restore."""

import uuid

import pytest
from sqlalchemy import func, select, update

from app.db.models import Document, Invoice, Job, ValidationIssue
from tests.conftest import API_HEADERS
from tests.helpers import seed_invoice

DOCS, INVOICES, STATS, SEARCH = (
    "/api/v1/documents",
    "/api/v1/invoices",
    "/api/v1/stats",
    "/api/v1/search",
)


def post(client, path):
    return client.post(path, headers=API_HEADERS)


def ids(client, path, **params) -> set[str]:
    r = client.get(path, params=params, headers=API_HEADERS)
    assert r.status_code == 200, r.text
    return {i["id"] for i in r.json()["items"]}


def rules(client, invoice_id) -> list[str]:
    body = client.get(f"{INVOICES}/{invoice_id}", headers=API_HEADERS).json()
    return sorted(i["rule_id"] for i in body["issues"])


def rows(db_session, model) -> int:
    db_session.expire_all()
    return db_session.scalar(select(func.count()).select_from(model))


# --- documents ----------------------------------------------------------------------------


def test_archive_document_hides_it_and_its_invoices_and_deletes_nothing(client, db_session):
    inv = seed_invoice(db_session)
    doc_id = str(inv.document_id)

    r = post(client, f"{DOCS}/{doc_id}/archive")
    assert r.status_code == 200 and r.json()["archived_at"] is not None

    assert doc_id not in ids(client, DOCS)
    assert str(inv.id) not in ids(client, INVOICES)
    assert doc_id in ids(client, DOCS, archived="true")
    assert str(inv.id) in ids(client, INVOICES, archived="true")
    # Still readable by id, with its archive stamp, so the Archived page can open it.
    detail = client.get(f"{DOCS}/{doc_id}", headers=API_HEADERS).json()
    assert detail["archived_at"] is not None and detail["invoice_count"] == 1
    assert client.get(f"{INVOICES}/{inv.id}", headers=API_HEADERS).json()["archived_at"]
    assert rows(db_session, Document) == 1 and rows(db_session, Invoice) == 1


def test_restore_document_brings_back_its_invoices(client, db_session):
    inv = seed_invoice(db_session)
    doc_id = str(inv.document_id)
    post(client, f"{DOCS}/{doc_id}/archive")

    r = post(client, f"{DOCS}/{doc_id}/restore")
    assert r.status_code == 200 and r.json()["archived_at"] is None
    assert doc_id in ids(client, DOCS) and str(inv.id) in ids(client, INVOICES)
    assert ids(client, DOCS, archived="true") == set()


def test_document_restore_keeps_an_invoice_that_was_archived_on_its_own(client, db_session):
    first = seed_invoice(db_session, number="INV-A")
    second = seed_invoice(
        db_session, document=db_session.get(Document, first.document_id), number="INV-B"
    )
    doc_id = str(first.document_id)
    assert post(client, f"{INVOICES}/{first.id}/archive").status_code == 200

    post(client, f"{DOCS}/{doc_id}/archive")
    post(client, f"{DOCS}/{doc_id}/restore")

    assert ids(client, INVOICES) == {str(second.id)}
    assert ids(client, INVOICES, archived="true") == {str(first.id)}
    # The document count shows the live invoices only.
    assert client.get(f"{DOCS}/{doc_id}", headers=API_HEADERS).json()["invoice_count"] == 1


def test_archive_and_restore_are_idempotent(client, db_session):
    inv = seed_invoice(db_session)
    doc_id = str(inv.document_id)
    first = post(client, f"{DOCS}/{doc_id}/archive").json()["archived_at"]
    assert post(client, f"{DOCS}/{doc_id}/archive").json()["archived_at"] == first
    assert post(client, f"{DOCS}/{doc_id}/restore").status_code == 200
    assert post(client, f"{DOCS}/{doc_id}/restore").json()["archived_at"] is None


@pytest.mark.parametrize("status", ["queued", "processing"])
def test_archive_and_restore_a_document_while_processing_is_409(client, db_session, status):
    inv = seed_invoice(db_session)
    doc_id = inv.document_id
    db_session.execute(update(Document).where(Document.id == doc_id).values(status=status))
    db_session.execute(update(Job).where(Job.document_id == doc_id).values(status=status))
    db_session.commit()

    assert post(client, f"{DOCS}/{doc_id}/archive").status_code == 409
    assert post(client, f"{INVOICES}/{inv.id}/archive").status_code == 409
    db_session.expire_all()
    assert db_session.get(Document, doc_id).archived_at is None


def test_restore_while_the_document_is_processing_is_409(client, db_session):
    inv = seed_invoice(db_session)
    post(client, f"{DOCS}/{inv.document_id}/archive")
    db_session.execute(
        update(Document).where(Document.id == inv.document_id).values(status="processing")
    )
    db_session.commit()
    assert post(client, f"{DOCS}/{inv.document_id}/restore").status_code == 409
    assert post(client, f"{INVOICES}/{inv.id}/restore").status_code == 409


def test_archive_unknown_and_malformed_ids(client):
    for path in (DOCS, INVOICES):
        assert post(client, f"{path}/{uuid.uuid4()}/archive").status_code == 404
        assert post(client, f"{path}/{uuid.uuid4()}/restore").status_code == 404
        assert post(client, f"{path}/not-a-uuid/archive").status_code == 422
    assert client.post(f"{DOCS}/{uuid.uuid4()}/archive").status_code == 401


# --- invoices -----------------------------------------------------------------------------


def test_archive_and_restore_one_invoice(client, db_session):
    inv = seed_invoice(db_session)
    r = post(client, f"{INVOICES}/{inv.id}/archive")
    assert r.status_code == 200 and r.json()["archived_at"] is not None
    assert str(inv.id) not in ids(client, INVOICES)
    # The document itself stays in the list.
    assert str(inv.document_id) in ids(client, DOCS)

    r = post(client, f"{INVOICES}/{inv.id}/restore")
    assert r.status_code == 200 and r.json()["archived_at"] is None
    assert str(inv.id) in ids(client, INVOICES)


def test_an_invoice_of_an_archived_document_cannot_be_restored_alone(client, db_session):
    inv = seed_invoice(db_session)
    post(client, f"{DOCS}/{inv.document_id}/archive")

    r = post(client, f"{INVOICES}/{inv.id}/restore")
    assert r.status_code == 409 and "document" in r.json()["detail"].lower()
    assert str(inv.id) in ids(client, INVOICES, archived="true")


def test_an_archived_invoice_cannot_be_corrected_or_approved(client, db_session):
    inv = seed_invoice(db_session)
    post(client, f"{INVOICES}/{inv.id}/archive")
    patch = client.patch(f"{INVOICES}/{inv.id}", json={"total": "9.00"}, headers=API_HEADERS)
    assert patch.status_code == 409
    assert post(client, f"{INVOICES}/{inv.id}/approve").status_code == 409
    post(client, f"{INVOICES}/{inv.id}/restore")
    assert post(client, f"{INVOICES}/{inv.id}/approve").status_code == 200


def test_document_invoice_list_respects_the_archive_flag(client, db_session):
    inv = seed_invoice(db_session)
    post(client, f"{INVOICES}/{inv.id}/archive")
    doc = str(inv.document_id)
    assert ids(client, INVOICES, document_id=doc) == set()
    assert ids(client, INVOICES, document_id=doc, archived="true") == {str(inv.id)}


# --- reprocess never destroys archived work -----------------------------------------------


def test_reprocess_is_refused_for_an_archived_document_or_archived_invoice(client, db_session):
    inv = seed_invoice(db_session)
    doc_id = str(inv.document_id)
    post(client, f"{INVOICES}/{inv.id}/archive")
    assert post(client, f"{DOCS}/{doc_id}/reprocess").status_code == 409

    post(client, f"{INVOICES}/{inv.id}/restore")
    post(client, f"{DOCS}/{doc_id}/archive")
    r = post(client, f"{DOCS}/{doc_id}/reprocess")
    assert r.status_code == 409 and "restore" in r.json()["detail"].lower()
    assert rows(db_session, Invoice) == 1


# --- stats, review queue, search ----------------------------------------------------------


def test_stats_ignore_archived_rows(client, db_session):
    keep = seed_invoice(db_session, number="INV-KEEP")
    gone = seed_invoice(db_session, number="INV-GONE")
    before = client.get(STATS, headers=API_HEADERS).json()
    assert before["documents"]["total"] == 2 and before["invoices"]["total"] == 2

    post(client, f"{DOCS}/{gone.document_id}/archive")
    after = client.get(STATS, headers=API_HEADERS).json()
    assert after["documents"]["total"] == 1 and after["documents"]["by_status"]["completed"] == 1
    assert after["invoices"]["total"] == 1
    assert after["needs_review"] == after["invoices"]["by_status"]["needs_review"]

    post(client, f"{INVOICES}/{keep.id}/archive")
    assert client.get(STATS, headers=API_HEADERS).json()["invoices"]["total"] == 0
    post(client, f"{DOCS}/{gone.document_id}/restore")
    assert client.get(STATS, headers=API_HEADERS).json()["invoices"]["total"] == 1


def test_review_queue_leaves_out_archived_invoices(client, db_session):
    inv = seed_invoice(db_session, total="1.00")  # totals disagree: needs review
    queue = {"status": "needs_review", "sort": "severity"}
    assert str(inv.id) in ids(client, INVOICES, **queue)
    post(client, f"{INVOICES}/{inv.id}/archive")
    assert str(inv.id) not in ids(client, INVOICES, **queue)
    post(client, f"{INVOICES}/{inv.id}/restore")
    assert str(inv.id) in ids(client, INVOICES, **queue)


@pytest.mark.parametrize("mode", ["keyword", "semantic", "hybrid"])
def test_search_leaves_out_archived_invoices(client, db_session, mode):
    inv = seed_invoice(db_session, number="INV-ZEBRA", supplier="Zebra Toner Co")

    def found() -> set[str]:
        r = client.get(SEARCH, params={"q": "Zebra Toner", "mode": mode}, headers=API_HEADERS)
        assert r.status_code == 200, r.text
        return {h["invoice"]["id"] for h in r.json()["items"]}

    assert str(inv.id) in found()
    post(client, f"{INVOICES}/{inv.id}/archive")
    assert found() == set()
    post(client, f"{INVOICES}/{inv.id}/restore")
    assert str(inv.id) in found()
    post(client, f"{DOCS}/{inv.document_id}/archive")
    assert found() == set()
    post(client, f"{DOCS}/{inv.document_id}/restore")
    assert str(inv.id) in found()


# --- duplicate rules V-07 and V-09 --------------------------------------------------------


def test_v07_ignores_an_archived_original_and_returns_on_restore(client, db_session):
    original = seed_invoice(db_session, number="INV-DUP", total="1150.00")
    copy = seed_invoice(db_session, number="INV-DUP", total="1150.00")
    assert "V-07" in rules(client, copy.id)

    post(client, f"{DOCS}/{original.document_id}/archive")
    assert "V-07" not in rules(client, copy.id)
    db_session.expire_all()
    assert (
        db_session.scalar(
            select(func.count(ValidationIssue.id)).where(
                ValidationIssue.related_invoice_id == original.id
            )
        )
        == 0
    )

    post(client, f"{DOCS}/{original.document_id}/restore")
    assert "V-07" in rules(client, copy.id)
    # The restored original is checked against the live data again.
    assert "V-07" in rules(client, original.id) or "V-07" in rules(client, copy.id)


def test_v09_ignores_an_archived_invoice_and_returns_on_restore(client, db_session):
    original = seed_invoice(db_session, number="INV-X9", total="1150.00")
    other = seed_invoice(
        db_session,
        number="INV-X9",
        total="999.00",
        subtotal="869.57",
        tax="129.43",
        items=(("A4 paper", "869.57"),),
    )
    assert "V-09" in rules(client, other.id)

    post(client, f"{INVOICES}/{original.id}/archive")
    assert "V-09" not in rules(client, other.id)
    post(client, f"{INVOICES}/{original.id}/restore")
    assert "V-09" in rules(client, other.id)


def test_a_new_duplicate_is_not_flagged_against_an_archived_invoice(client, db_session):
    original = seed_invoice(db_session, number="INV-NEW", total="1150.00")
    post(client, f"{INVOICES}/{original.id}/archive")
    later = seed_invoice(db_session, number="INV-NEW", total="1150.00")
    assert "V-07" not in rules(client, later.id) and "V-09" not in rules(client, later.id)


# --- the old DELETE endpoint is untouched --------------------------------------------------


def test_the_old_delete_endpoint_still_works(client, db_session):
    inv = seed_invoice(db_session)
    r = client.delete(f"{DOCS}/{inv.document_id}", headers=API_HEADERS)
    assert r.status_code == 204
    assert rows(db_session, Document) == 0
