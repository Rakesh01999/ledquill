"""API contract for GET /search."""

from typing import Literal

from pydantic import BaseModel

from app.schemas.invoices import InvoiceOut

SearchMode = Literal["keyword", "semantic", "hybrid"]


class SearchHit(BaseModel):
    score: float  # keyword: ts_rank; semantic: cosine similarity; hybrid: RRF score
    matched_by: list[Literal["keyword", "semantic"]]
    invoice: InvoiceOut


class SearchResponse(BaseModel):
    items: list[SearchHit]
    total: int  # items returned (at most `limit`), not a count of every match
    mode: SearchMode  # what the caller asked for
    mode_used: SearchMode  # what ran; keyword when semantic search was unavailable
    fallback_reason: Literal["semantic_disabled", "embedder_error"] | None
