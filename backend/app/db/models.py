"""SQLAlchemy 2 models: the full schema from docs/design.md section 2.

Money is Numeric (never float). Duplicates are stored and flagged, not blocked.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    CHAR,
    REAL,
    BigInteger,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

EMBEDDING_DIMS = 384


class Base(DeclarativeBase):
    pass


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _updated_at() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Document(Base):
    """One uploaded file."""

    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_sha256", "sha256"),
        Index("ix_documents_status_created_at", "status", text("created_at DESC")),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    file_type: Mapped[str] = mapped_column(Text, nullable=False)  # pdf|image|xlsx|xls|csv
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="queued")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    jobs: Mapped[list["Job"]] = relationship(back_populates="document", passive_deletes=True)
    pages: Mapped[list["Page"]] = relationship(back_populates="document", passive_deletes=True)
    invoices: Mapped[list["Invoice"]] = relationship(
        back_populates="document", passive_deletes=True
    )


class Job(Base):
    """One processing attempt (first run or reprocess)."""

    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)  # process|reprocess
    status: Mapped[str] = mapped_column(Text, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    current_stage: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    document: Mapped[Document] = relationship(back_populates="jobs")


class Page(Base):
    """Text of each page or sheet."""

    __tablename__ = "pages"
    __table_args__ = (UniqueConstraint("document_id", "page_no"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    page_no: Mapped[int] = mapped_column(Integer, nullable=False)  # sheet index for spreadsheets
    method: Mapped[str] = mapped_column(Text, nullable=False)  # text|ocr|sheet
    text: Mapped[str | None] = mapped_column(Text)
    ocr_confidence: Mapped[float | None] = mapped_column(REAL)

    document: Mapped[Document] = relationship(back_populates="pages")


class Invoice(Base):
    """One extracted invoice (a document can hold many)."""

    __tablename__ = "invoices"
    __table_args__ = (
        Index("ix_invoices_supplier_norm_invoice_number", "supplier_norm", "invoice_number"),
        Index("ix_invoices_invoice_date", "invoice_date"),
        Index("ix_invoices_total", "total"),
        Index("ix_invoices_status", "status"),
        Index("ix_invoices_search_tsv", "search_tsv", postgresql_using="gin"),
        Index(
            "ix_invoices_supplier_name_trgm",
            "supplier_name",
            postgresql_using="gin",
            postgresql_ops={"supplier_name": "gin_trgm_ops"},
        ),
        Index(
            "ix_invoices_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    page_numbers: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    invoice_number: Mapped[str | None] = mapped_column(Text)
    invoice_date: Mapped[date | None] = mapped_column(Date)
    supplier_name: Mapped[str | None] = mapped_column(Text)
    customer_name: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str | None] = mapped_column(CHAR(3))
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    tax: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    confidence: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    raw_extraction: Mapped[dict | None] = mapped_column(JSONB)  # rules + LLM output, for audit
    method: Mapped[str | None] = mapped_column(Text)  # rules|llm|rules+llm
    model: Mapped[str | None] = mapped_column(Text)  # which LLM answered
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="needs_review")
    supplier_norm: Mapped[str | None] = mapped_column(Text)
    search_text: Mapped[str | None] = mapped_column(Text)
    search_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR, Computed("to_tsvector('english', coalesce(search_text,''))", persisted=True)
    )
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIMS))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    document: Mapped[Document] = relationship(back_populates="invoices")
    line_items: Mapped[list["LineItem"]] = relationship(
        back_populates="invoice", passive_deletes=True, order_by="LineItem.line_no"
    )
    issues: Mapped[list["ValidationIssue"]] = relationship(
        back_populates="invoice",
        passive_deletes=True,
        foreign_keys="ValidationIssue.invoice_id",
    )
    corrections: Mapped[list["Correction"]] = relationship(
        back_populates="invoice",
        passive_deletes=True,
        order_by="Correction.created_at, Correction.field",
    )

    @property
    def corrected_fields(self) -> list[str]:
        """Fields a reviewer changed, in first-corrected order (the UI shows "verified")."""
        return list(dict.fromkeys(c.field for c in self.corrections))


class LineItem(Base):
    __tablename__ = "line_items"

    id: Mapped[uuid.UUID] = _uuid_pk()
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    invoice: Mapped[Invoice] = relationship(back_populates="line_items")


class ValidationIssue(Base):
    """Every failed rule, with what was expected."""

    __tablename__ = "validation_issues"

    id: Mapped[uuid.UUID] = _uuid_pk()
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    rule_id: Mapped[str] = mapped_column(Text, nullable=False)  # V-01 ... V-09
    severity: Mapped[str] = mapped_column(Text, nullable=False)  # error|warning
    field: Mapped[str | None] = mapped_column(Text)
    expected: Mapped[str | None] = mapped_column(Text)
    actual: Mapped[str | None] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    related_invoice_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("invoices.id"))
    created_at: Mapped[datetime] = _created_at()

    invoice: Mapped[Invoice] = relationship(back_populates="issues", foreign_keys=[invoice_id])


class Correction(Base):
    """Audit trail of manual fixes."""

    __tablename__ = "corrections"

    id: Mapped[uuid.UUID] = _uuid_pk()
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    field: Mapped[str] = mapped_column(Text, nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()

    invoice: Mapped[Invoice] = relationship(back_populates="corrections")


class ProcessingEvent(Base):
    """Processing history and timings."""

    __tablename__ = "processing_events"
    __table_args__ = (
        Index("ix_processing_events_document_id_created_at", "document_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    stage: Mapped[str] = mapped_column(Text, nullable=False)  # detect|extract|split|...
    status: Mapped[str] = mapped_column(Text, nullable=False)  # started|succeeded|failed
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    detail: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()
