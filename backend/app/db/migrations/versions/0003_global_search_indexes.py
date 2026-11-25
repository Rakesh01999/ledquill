"""Trigram indexes for the global search box (substring match on file names and invoice numbers).

Additive: two GIN indexes, no data is changed. The supplier name already has one (0001).

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-26
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_invoices_invoice_number_trgm",
        "invoices",
        ["invoice_number"],
        postgresql_using="gin",
        postgresql_ops={"invoice_number": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_documents_filename_trgm",
        "documents",
        ["filename"],
        postgresql_using="gin",
        postgresql_ops={"filename": "gin_trgm_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_documents_filename_trgm", table_name="documents")
    op.drop_index("ix_invoices_invoice_number_trgm", table_name="invoices")
