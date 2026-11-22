"""Initial schema (docs/design.md section 2).

Revision ID: 0001
Revises:
Create Date: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql as pg

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NOW = sa.text("now()")


def _id() -> sa.Column:
    return sa.Column("id", pg.UUID(as_uuid=True), primary_key=True)


def _fk(name: str, target: str, *, ondelete: str | None = "CASCADE", nullable: bool = False):
    return sa.Column(name, pg.UUID(as_uuid=True), sa.ForeignKey(target, ondelete=ondelete), nullable=nullable)


def _ts(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=NOW, nullable=False)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "documents",
        _id(),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("file_type", sa.Text, nullable=False),
        sa.Column("mime_type", sa.Text, nullable=False),
        sa.Column("sha256", sa.CHAR(64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("storage_key", sa.Text, nullable=False),
        sa.Column("page_count", sa.Integer),
        sa.Column("status", sa.Text, nullable=False, server_default="queued"),
        sa.Column("progress", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error", sa.Text),
        _ts("created_at"),
        _ts("updated_at"),
    )
    op.create_index("ix_documents_sha256", "documents", ["sha256"])
    op.create_index(
        "ix_documents_status_created_at", "documents", ["status", sa.text("created_at DESC")]
    )

    op.create_table(
        "jobs",
        _id(),
        _fk("document_id", "documents.id"),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("current_stage", sa.Text),
        sa.Column("error", sa.Text),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "pages",
        _id(),
        _fk("document_id", "documents.id"),
        sa.Column("page_no", sa.Integer, nullable=False),
        sa.Column("method", sa.Text, nullable=False),
        sa.Column("text", sa.Text),
        sa.Column("ocr_confidence", sa.REAL),
        sa.UniqueConstraint("document_id", "page_no"),
    )

    op.create_table(
        "invoices",
        _id(),
        _fk("document_id", "documents.id"),
        sa.Column("page_numbers", pg.ARRAY(sa.Integer)),
        sa.Column("invoice_number", sa.Text),
        sa.Column("invoice_date", sa.Date),
        sa.Column("supplier_name", sa.Text),
        sa.Column("customer_name", sa.Text),
        sa.Column("currency", sa.CHAR(3)),
        sa.Column("subtotal", sa.Numeric(14, 2)),
        sa.Column("tax", sa.Numeric(14, 2)),
        sa.Column("total", sa.Numeric(14, 2)),
        sa.Column("confidence", pg.JSONB, nullable=False, server_default="{}"),
        sa.Column("raw_extraction", pg.JSONB),
        sa.Column("method", sa.Text),
        sa.Column("model", sa.Text),
        sa.Column("status", sa.Text, nullable=False, server_default="needs_review"),
        sa.Column("supplier_norm", sa.Text),
        sa.Column("search_text", sa.Text),
        sa.Column(
            "search_tsv",
            pg.TSVECTOR,
            sa.Computed("to_tsvector('english', coalesce(search_text,''))", persisted=True),
        ),
        sa.Column("embedding", Vector(384)),
        _ts("created_at"),
        _ts("updated_at"),
    )
    op.create_index(
        "ix_invoices_supplier_norm_invoice_number", "invoices", ["supplier_norm", "invoice_number"]
    )
    op.create_index("ix_invoices_invoice_date", "invoices", ["invoice_date"])
    op.create_index("ix_invoices_total", "invoices", ["total"])
    op.create_index("ix_invoices_status", "invoices", ["status"])
    op.create_index("ix_invoices_search_tsv", "invoices", ["search_tsv"], postgresql_using="gin")
    op.create_index(
        "ix_invoices_supplier_name_trgm",
        "invoices",
        ["supplier_name"],
        postgresql_using="gin",
        postgresql_ops={"supplier_name": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_invoices_embedding_hnsw",
        "invoices",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )

    op.create_table(
        "line_items",
        _id(),
        _fk("invoice_id", "invoices.id"),
        sa.Column("line_no", sa.Integer, nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("quantity", sa.Numeric(14, 4)),
        sa.Column("unit_price", sa.Numeric(14, 4)),
        sa.Column("amount", sa.Numeric(14, 2)),
    )

    op.create_table(
        "validation_issues",
        _id(),
        _fk("invoice_id", "invoices.id"),
        sa.Column("rule_id", sa.Text, nullable=False),
        sa.Column("severity", sa.Text, nullable=False),
        sa.Column("field", sa.Text),
        sa.Column("expected", sa.Text),
        sa.Column("actual", sa.Text),
        sa.Column("message", sa.Text, nullable=False),
        _fk("related_invoice_id", "invoices.id", ondelete=None, nullable=True),
        _ts("created_at"),
    )

    op.create_table(
        "corrections",
        _id(),
        _fk("invoice_id", "invoices.id"),
        sa.Column("field", sa.Text, nullable=False),
        sa.Column("old_value", sa.Text),
        sa.Column("new_value", sa.Text),
        sa.Column("note", sa.Text),
        _ts("created_at"),
    )

    op.create_table(
        "processing_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        _fk("document_id", "documents.id"),
        _fk("job_id", "jobs.id", nullable=True),
        sa.Column("stage", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("duration_ms", sa.Integer),
        sa.Column("detail", pg.JSONB),
        _ts("created_at"),
    )
    op.create_index(
        "ix_processing_events_document_id_created_at",
        "processing_events",
        ["document_id", "created_at"],
    )


def downgrade() -> None:
    for table in (
        "processing_events",
        "corrections",
        "validation_issues",
        "line_items",
        "invoices",
        "pages",
        "jobs",
        "documents",
    ):
        op.drop_table(table)  # indexes are dropped with their tables
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
    op.execute("DROP EXTENSION IF EXISTS vector")
