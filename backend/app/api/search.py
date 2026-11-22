"""GET /search: keyword, semantic or hybrid ranking in one list (FR-18, FR-19)."""

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.ratelimit import limiter, search_limit
from app.core.security import require_api_key
from app.db.session import get_session
from app.pipeline.embed import Embedder, get_embedder
from app.schemas.invoices import InvoiceOut
from app.schemas.search import SearchHit, SearchMode, SearchResponse
from app.services.search import search_invoices

router = APIRouter(tags=["search"], dependencies=[Depends(require_api_key)])


@router.get("/search", response_model=SearchResponse)
@limiter.limit(search_limit)
def search(
    request: Request,
    response: Response,
    q: str = Query(..., min_length=1, max_length=500, pattern=r"\S"),
    mode: SearchMode = "hybrid",
    limit: int = Query(10, ge=1, le=50),
    session: Session = Depends(get_session),
    embedder: Embedder | None = Depends(get_embedder),
):
    """One ranked list of invoices. `hybrid` (default) fuses keyword and semantic rankings.
    Semantic ranking has no minimum score: it always returns the nearest invoices, so treat
    low scores as weak matches. Without a working model, semantic and hybrid fall back to
    keyword and report it in `mode_used` and `fallback_reason`."""
    outcome = search_invoices(session, q.strip(), mode, limit, embedder)
    items = [
        SearchHit(
            score=hit.score, matched_by=hit.matched_by, invoice=InvoiceOut.model_validate(inv)
        )
        for hit, inv in outcome.hits
    ]
    return SearchResponse(
        items=items,
        total=len(items),
        mode=mode,
        mode_used=outcome.mode_used,
        fallback_reason=outcome.fallback_reason,
    )
