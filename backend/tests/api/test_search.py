"""GET /search and the embedding paths: index stage, re-embed on correction, fallbacks."""

import sys
import uuid

import pytest
from sqlalchemy import select

from app.db.models import Invoice, ProcessingEvent
from app.pipeline import embed
from app.pipeline.embed import get_embedder
from app.services.search import RRF_K, Hit, fuse
from tests.api.test_invoices import upload_mismatch
from tests.conftest import API_HEADERS
from tests.fakes import FailingEmbedder, StubEmbedder
from tests.fixtures.builders import MISMATCH_LLM
from tests.helpers import seed_invoice

SEARCH, INVOICES, DOCS = "/api/v1/search", "/api/v1/invoices", "/api/v1/documents"


def search(client, q="toner", **params):
    return client.get(SEARCH, params={"q": q, **params}, headers=API_HEADERS)


def numbers(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [h["invoice"]["invoice_number"] for h in response.json()["items"]]


@pytest.fixture
def corpus(db_session):
    """Three invoices: paper, toner, consulting. 'stationery' relates to the first two only in the
    stub's meaning space; no invoice contains that word."""

    def make(number, supplier, item, amount):
        return seed_invoice(
            db_session,
            number=number,
            supplier=supplier,
            items=((item, amount),),
            subtotal=amount,
            tax="0.00",
            total=amount,
        )

    return {
        "paper": make("INV-100", "Acme Supplies", "A4 paper", "100.00"),
        "toner": make("INV-200", "Globex Trading", "Printer toner", "200.00"),
        "consulting": make("INV-300", "Initech LLC", "Consulting hours", "5000.00"),
    }


@pytest.fixture
def broken_embedder(monkeypatch):
    """The API and the worker both get an embedder whose model cannot load."""
    monkeypatch.setattr(embed, "FastEmbedder", lambda *_a, **_k: FailingEmbedder())
    get_embedder.cache_clear()


@pytest.fixture
def semantic_off(settings, monkeypatch):
    monkeypatch.setattr(settings, "ledquill_semantic_enabled", False)
    get_embedder.cache_clear()


# --- ranking ------------------------------------------------------------------------------


def test_fuse_is_reciprocal_rank_fusion():
    a, b, c = (uuid.uuid4() for _ in range(3))
    keyword = [Hit(a, 9.0, ["keyword"]), Hit(b, 5.0, ["keyword"]), Hit(c, 1.0, ["keyword"])]
    semantic = [Hit(c, 0.9, ["semantic"]), Hit(a, 0.8, ["semantic"])]
    fused = fuse([keyword, semantic])
    assert [h.invoice_id for h in fused] == [a, c, b]
    assert fused[0].score == pytest.approx(1 / (RRF_K + 1) + 1 / (RRF_K + 2))
    assert fused[1].score == pytest.approx(1 / (RRF_K + 3) + 1 / (RRF_K + 1))
    assert fused[2].score == pytest.approx(1 / (RRF_K + 2))
    assert sorted(fused[0].matched_by) == ["keyword", "semantic"] and fused[2].matched_by == [
        "keyword"
    ]


def test_keyword_mode_matches_words_and_exact_invoice_numbers(client, corpus):
    assert numbers(search(client, "toner", mode="keyword")) == ["INV-200"]
    assert numbers(search(client, "INV-300", mode="keyword")) == ["INV-300"]
    assert numbers(search(client, "zeppelin", mode="keyword")) == []
    body = search(client, "toner", mode="keyword").json()
    assert body["mode"] == body["mode_used"] == "keyword" and body["fallback_reason"] is None
    assert body["items"][0]["matched_by"] == ["keyword"] and body["items"][0]["score"] > 0


def test_semantic_mode_finds_meaning_without_a_shared_word(client, corpus):
    body = search(client, "stationery", mode="semantic").json()
    assert body["mode_used"] == "semantic"
    top_two = [h["invoice"]["invoice_number"] for h in body["items"][:2]]
    assert sorted(top_two) == ["INV-100", "INV-200"]
    assert all(h["matched_by"] == ["semantic"] for h in body["items"])
    assert body["items"][0]["score"] > body["items"][-1]["score"]
    assert numbers(search(client, "stationery", mode="keyword")) == []  # no word in common


def test_hybrid_is_the_default_and_merges_both_rankings(client, corpus):
    default = search(client, "toner")
    assert default.json()["mode"] == "hybrid" == default.json()["mode_used"]
    hits = default.json()["items"]
    assert hits[0]["invoice"]["invoice_number"] == "INV-200"  # in both lists, ranked first
    assert sorted(hits[0]["matched_by"]) == ["keyword", "semantic"]
    assert hits[0]["score"] > 1 / (RRF_K + 1)  # two lists beat the best single-list score
    assert len(hits) == 3 and hits[0]["score"] > hits[1]["score"]  # semantic adds the rest


def test_hybrid_finds_an_exact_invoice_number(client, corpus):
    assert numbers(search(client, "INV-300"))[0] == "INV-300"


def test_hybrid_without_any_embedded_invoice_is_keyword_ranked(client, db_session):
    seed_invoice(db_session, number="INV-900", embedded=False)
    body = search(client, "INV-900").json()
    assert body["mode_used"] == "hybrid" and numbers(search(client, "INV-900")) == ["INV-900"]
    assert body["items"][0]["matched_by"] == ["keyword"]


def test_limit_and_response_shape(client, corpus):
    body = search(client, "stationery", mode="semantic", limit=2).json()
    assert body["total"] == len(body["items"]) == 2
    invoice = body["items"][0]["invoice"]
    assert invoice["total"] in ("100.00", "200.00") and isinstance(invoice["total"], str)
    assert {"line_items", "issues", "corrections", "corrected_fields"} <= invoice.keys()


def test_keyword_mode_never_touches_the_embedder(app, client, corpus):
    spy = StubEmbedder()
    app.dependency_overrides[get_embedder] = lambda: spy
    search(client, "toner", mode="keyword")
    assert spy.query_calls == 0
    search(client, "toner", mode="hybrid")
    assert spy.query_calls == 1


# --- fallbacks ----------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["hybrid", "semantic"])
def test_a_failing_embedder_falls_back_to_keyword_and_says_so(
    client, corpus, broken_embedder, mode
):
    r = search(client, "toner", mode=mode)
    body = r.json()
    assert r.status_code == 200
    assert body["mode"] == mode and body["mode_used"] == "keyword"
    assert body["fallback_reason"] == "embedder_error"
    assert numbers(r) == ["INV-200"]


@pytest.mark.parametrize("mode", ["hybrid", "semantic"])
def test_disabled_semantic_search_falls_back_to_keyword(client, corpus, semantic_off, mode):
    body = search(client, "toner", mode=mode).json()
    assert body["mode_used"] == "keyword" and body["fallback_reason"] == "semantic_disabled"
    assert [h["invoice"]["invoice_number"] for h in body["items"]] == ["INV-200"]


def test_disabled_semantic_search_has_no_embedder(semantic_off):
    assert get_embedder() is None


# --- validation, auth, limits ---------------------------------------------------------------


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"q": ""},
        {"q": "   "},
        {"q": "x" * 501},
        {"q": "toner", "mode": "fuzzy"},
        {"q": "toner", "limit": 0},
        {"q": "toner", "limit": 51},
    ],
)
def test_bad_search_requests_are_422_problem_json(client, params):
    r = client.get(SEARCH, params=params, headers=API_HEADERS)
    assert r.status_code == 422 and r.headers["content-type"].startswith("application/problem+json")


def test_search_requires_the_api_key(client):
    r = client.get(SEARCH, params={"q": "toner"})
    assert r.status_code == 401 and r.headers["content-type"].startswith("application/problem+json")


def test_query_text_is_data_not_syntax(client, corpus):
    for hostile in ("'; DROP TABLE invoices; --", "toner & | ! ( ", '"unbalanced', "%_\\"):
        assert search(client, hostile, mode="keyword").status_code == 200
    assert numbers(search(client, "toner", mode="keyword")) == ["INV-200"]


def test_search_is_rate_limited_with_retry_after(client, corpus, settings, monkeypatch):
    monkeypatch.setattr(settings, "ledquill_rate_limit_search", "2/minute")
    assert search(client).status_code == 200 and search(client).status_code == 200
    blocked = search(client)
    assert blocked.status_code == 429 and blocked.headers["content-type"].startswith(
        "application/problem"
    )
    assert 1 <= int(blocked.headers["retry-after"]) <= 60
    assert client.get(INVOICES, headers=API_HEADERS).status_code == 200  # other routes unaffected


# --- index stage ----------------------------------------------------------------------------


def events(db_session, document_id, stage="index"):
    db_session.expire_all()
    return db_session.scalars(
        select(ProcessingEvent)
        .where(ProcessingEvent.document_id == document_id, ProcessingEvent.stage == stage)
        .order_by(ProcessingEvent.id)
    ).all()


def only_invoice(db_session, document_id) -> Invoice:
    db_session.expire_all()
    return db_session.scalars(select(Invoice).where(Invoice.document_id == document_id)).one()


def test_the_index_stage_embeds_each_invoice(client, db_session, fake_llm, tmp_path):
    fake_llm.default = MISMATCH_LLM
    doc_id = uuid.UUID(upload_mismatch(client, tmp_path))
    invoice = only_invoice(db_session, doc_id)
    assert invoice.search_text and "INV-5001" in invoice.search_text
    assert invoice.embedding is not None and len(invoice.embedding) == 384
    started, succeeded = events(db_session, doc_id)
    assert (started.status, succeeded.status) == ("started", "succeeded")
    assert succeeded.detail == {"embedded": 1, "invoices": 1} and succeeded.duration_ms is not None
    found = search(client, "INV-5001", mode="semantic").json()
    assert found["items"][0]["invoice"]["id"] == str(invoice.id)


def test_an_embedding_failure_is_recorded_and_the_job_still_succeeds(
    client, db_session, fake_llm, tmp_path, broken_embedder
):
    fake_llm.default = MISMATCH_LLM
    doc_id = uuid.UUID(upload_mismatch(client, tmp_path))
    doc = client.get(f"{DOCS}/{doc_id}", headers=API_HEADERS).json()
    assert doc["status"] == "completed" and doc["progress"] == 100 and doc["error"] is None
    assert client.get(f"/api/v1/jobs/{doc['job_id']}", headers=API_HEADERS).json()["status"] == (
        "completed"
    )
    _, failed = events(db_session, doc_id)
    assert failed.status == "failed" and failed.detail == {
        "error": "OSError"
    }  # recorded, not silent
    invoice = only_invoice(db_session, doc_id)
    assert invoice.embedding is None
    assert numbers(search(client, "INV-5001", mode="keyword")) == ["INV-5001"]  # keyword unaffected


def test_a_disabled_index_stage_skips_and_says_why(
    client, db_session, fake_llm, tmp_path, semantic_off
):
    fake_llm.default = MISMATCH_LLM
    doc_id = uuid.UUID(upload_mismatch(client, tmp_path))
    assert client.get(f"{DOCS}/{doc_id}", headers=API_HEADERS).json()["status"] == "completed"
    _, done = events(db_session, doc_id)
    assert done.status == "succeeded" and done.detail["embedded"] == 0
    assert "disabled" in done.detail["skipped"]
    assert only_invoice(db_session, doc_id).embedding is None


def test_reprocess_embeds_again_without_duplicates(client, db_session, fake_llm, tmp_path):
    fake_llm.default = MISMATCH_LLM
    doc_id = upload_mismatch(client, tmp_path)
    client.post(f"{DOCS}/{doc_id}/reprocess", headers=API_HEADERS)
    assert only_invoice(db_session, uuid.UUID(doc_id)).embedding is not None


def test_the_model_is_never_imported_by_the_test_suite():
    assert "fastembed" not in sys.modules  # CI must not download or even load the real model


# --- correction re-embeds -------------------------------------------------------------------


def patch(client, invoice_id, body):
    return client.patch(f"{INVOICES}/{invoice_id}", json=body, headers=API_HEADERS)


def test_a_correction_refreshes_the_embedding(client, db_session, corpus):
    before = list(corpus["paper"].embedding)
    assert (
        patch(client, corpus["paper"].id, {"supplier_name": "Zenith Partners"}).status_code == 200
    )
    db_session.expire_all()
    after = db_session.get(Invoice, corpus["paper"].id)
    assert after.embedding is not None and list(after.embedding) != before
    assert "Zenith" in after.search_text


def test_a_correction_with_a_failing_embedder_drops_the_stale_vector_and_records_it(
    client, db_session, corpus, broken_embedder
):
    assert (
        patch(client, corpus["paper"].id, {"supplier_name": "Zenith Partners"}).status_code == 200
    )
    db_session.expire_all()
    assert db_session.get(Invoice, corpus["paper"].id).embedding is None
    (event,) = events(db_session, corpus["paper"].document_id)
    assert event.status == "failed" and event.job_id is None
    assert event.detail["trigger"] == "correction" and event.detail["error"] == "OSError"
    assert event.detail["invoice_id"] == str(corpus["paper"].id)


def test_a_correction_with_semantic_search_disabled_clears_the_vector_quietly(
    client, db_session, corpus, semantic_off
):
    assert (
        patch(client, corpus["toner"].id, {"supplier_name": "Zenith Partners"}).status_code == 200
    )
    db_session.expire_all()
    assert db_session.get(Invoice, corpus["toner"].id).embedding is None
    assert events(db_session, corpus["toner"].document_id) == []  # disabled is not a failure


def test_a_no_op_correction_keeps_the_embedding(client, db_session, corpus):
    before = list(corpus["paper"].embedding)
    patch(client, corpus["paper"].id, {"invoice_number": "INV-100"})
    db_session.expire_all()
    stored = list(db_session.get(Invoice, corpus["paper"].id).embedding)
    assert stored == pytest.approx(before, abs=1e-6)  # the column stores float32


# --- embedding never holds the invoice lock ---------------------------------------------------


class LockProbe(StubEmbedder):
    """While embedding, tries to lock the invoice row from another connection."""

    def __init__(self, invoice_id, mutate=None):
        super().__init__()
        self.invoice_id, self.mutate, self.lock_error = invoice_id, mutate, None

    def embed_passages(self, texts):
        from sqlalchemy.exc import OperationalError

        from app.db.session import new_session

        with new_session() as other:
            try:
                other.execute(
                    select(Invoice.id)
                    .where(Invoice.id == self.invoice_id)
                    .with_for_update(nowait=True)
                ).all()
            except OperationalError as exc:
                self.lock_error = type(exc).__name__
            if self.mutate:  # a second correction lands while this one is embedding
                other.execute(
                    Invoice.__table__.update()
                    .where(Invoice.id == self.invoice_id)
                    .values(search_text="newer text")
                )
                other.commit()
        return super().embed_passages(texts)


def test_the_embedding_is_computed_after_the_correction_committed(app, client, corpus):
    probe = LockProbe(corpus["paper"].id)
    app.dependency_overrides[get_embedder] = lambda: probe
    assert (
        patch(client, corpus["paper"].id, {"supplier_name": "Zenith Partners"}).status_code == 200
    )
    assert probe.passage_calls == 1 and probe.lock_error is None  # the row was not locked


def test_a_newer_correction_owns_the_vector(app, client, db_session, corpus):
    probe = LockProbe(corpus["paper"].id, mutate=True)
    app.dependency_overrides[get_embedder] = lambda: probe
    assert (
        patch(client, corpus["paper"].id, {"supplier_name": "Zenith Partners"}).status_code == 200
    )
    db_session.expire_all()
    stale = db_session.get(Invoice, corpus["paper"].id)
    assert stale.search_text == "newer text" and stale.embedding is None  # not overwritten


# --- a failing vector write is not fatal -------------------------------------------------------


def test_a_database_error_while_writing_vectors_does_not_fail_the_job(
    client, db_session, fake_llm, tmp_path, monkeypatch
):
    class WrongSize(StubEmbedder):
        def embed_passages(self, texts):
            return [[0.1, 0.2, 0.3] for _ in texts]  # the column wants 384 dimensions

    monkeypatch.setattr(embed, "FastEmbedder", lambda *_a, **_k: WrongSize())
    get_embedder.cache_clear()
    fake_llm.default = MISMATCH_LLM
    doc_id = uuid.UUID(upload_mismatch(client, tmp_path))
    doc = client.get(f"{DOCS}/{doc_id}", headers=API_HEADERS).json()
    assert doc["status"] == "completed" and doc["error"] is None
    _, failed = events(db_session, doc_id)
    assert failed.status == "failed" and failed.detail["error"] == "DataError"
    assert only_invoice(db_session, doc_id).embedding is None
