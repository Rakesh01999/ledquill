"""Invoice search: keyword (full text), semantic (vector) and hybrid (reciprocal rank fusion)."""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.db.models import Invoice
from app.pipeline.embed import Embedder, EmbeddingError
from app.services.invoices import LOAD

log = get_logger(__name__)
POOL = 50  # candidates taken from each ranking before fusion
RRF_K = 60  # standard reciprocal-rank-fusion constant


@dataclass
class Hit:
    invoice_id: uuid.UUID
    score: float
    matched_by: list[str] = field(default_factory=list)


@dataclass
class SearchOutcome:
    hits: list[tuple[Hit, Invoice]]
    mode_used: str
    fallback_reason: str | None = None


def keyword_ranking(session: Session, q: str, limit: int) -> list[Hit]:
    """Invoices whose indexed text matches `q`, best ts_rank first."""
    query = func.websearch_to_tsquery("english", q)
    rank = func.ts_rank(Invoice.search_tsv, query)
    rows = session.execute(
        select(Invoice.id, rank)
        .where(Invoice.search_tsv.op("@@")(query), Invoice.archived_at.is_(None))
        .order_by(rank.desc(), Invoice.id)
        .limit(limit)
    ).all()
    return [Hit(i, float(r), ["keyword"]) for i, r in rows]


def semantic_ranking(session: Session, vector: list[float], limit: int) -> list[Hit]:
    """Embedded invoices nearest to the query vector; score is cosine similarity."""
    distance = Invoice.embedding.cosine_distance(vector)
    rows = session.execute(
        select(Invoice.id, distance)
        .where(Invoice.embedding.is_not(None), Invoice.archived_at.is_(None))
        .order_by(distance, Invoice.id)
        .limit(limit)
    ).all()
    return [Hit(i, 1.0 - float(d), ["semantic"]) for i, d in rows]


def fuse(rankings: list[list[Hit]]) -> list[Hit]:
    """Reciprocal rank fusion: score = sum of 1 / (60 + rank) over every list an invoice is in."""
    fused: dict[uuid.UUID, Hit] = {}
    for ranking in rankings:
        for rank, hit in enumerate(ranking, start=1):
            merged = fused.setdefault(hit.invoice_id, Hit(hit.invoice_id, 0.0))
            merged.score += 1.0 / (RRF_K + rank)
            merged.matched_by.extend(hit.matched_by)
    return sorted(fused.values(), key=lambda h: (-h.score, str(h.invoice_id)))


def search_invoices(
    session: Session, q: str, mode: str, limit: int, embedder: Embedder | None
) -> SearchOutcome:
    """One query, one ranked list. Semantic and hybrid fall back to keyword, and say why, when
    semantic search is disabled or the model fails."""
    pool = max(POOL, limit)
    mode_used, reason = mode, None
    rankings: list[list[Hit]] = []
    if mode in ("semantic", "hybrid"):
        if embedder is None:
            mode_used, reason = "keyword", "semantic_disabled"
        else:
            try:
                vector = embedder.embed_query(q)
            except EmbeddingError as exc:
                log.warning("search_embedding_failed", reason=str(exc))
                mode_used, reason = "keyword", "embedder_error"
            else:
                rankings.append(semantic_ranking(session, vector, pool))
    if mode_used in ("keyword", "hybrid"):
        rankings.append(keyword_ranking(session, q, pool))

    hits = fuse(rankings) if mode_used == "hybrid" else (rankings[0] if rankings else [])
    hits = hits[:limit]
    invoices = {
        i.id: i
        for i in session.scalars(
            select(Invoice).where(Invoice.id.in_([h.invoice_id for h in hits])).options(*LOAD)
        )
    }
    return SearchOutcome([(h, invoices[h.invoice_id]) for h in hits], mode_used, reason)
