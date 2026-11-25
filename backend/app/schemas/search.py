"""API contract for GET /search and GET /search/global."""

import uuid
from datetime import date, datetime
from decimal import Decimal
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


# --- GET /search/global: one box over documents, invoices, suppliers and archived items -------


class DocumentHit(BaseModel):
    id: uuid.UUID
    filename: str
    file_type: str
    status: str
    created_at: datetime


class InvoiceHit(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    invoice_number: str | None
    supplier_name: str | None
    total: Decimal | None
    currency: str | None
    invoice_date: date | None
    status: str


class SupplierHit(BaseModel):
    supplier: str  # exact name, as GET /invoices?supplier_exact= takes it
    count: int  # live invoices from this supplier


class ArchivedHit(BaseModel):
    """An archived document or invoice. Never mixed into the live groups."""

    kind: Literal["document", "invoice"]
    id: uuid.UUID
    document_id: uuid.UUID  # the file itself for a document
    title: str  # file name, or the invoice number
    detail: str | None  # invoice: supplier and amount; document: file type
    archived_at: datetime


class GlobalGroup[T](BaseModel):
    items: list[T]
    more: bool  # there are more matches than `limit`


class GlobalSearch(BaseModel):
    q: str  # the query as searched (trimmed)
    documents: GlobalGroup[DocumentHit]
    invoices: GlobalGroup[InvoiceHit]
    suppliers: GlobalGroup[SupplierHit]
    archived: GlobalGroup[ArchivedHit]
