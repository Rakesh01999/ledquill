"""Archive: documents and invoices can be hidden and restored, never deleted.

Additive: two nullable columns and two indexes. No data is changed or removed.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("documents", "invoices"):
        op.add_column(table, sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index(f"ix_{table}_archived_at", table, ["archived_at"])


def downgrade() -> None:
    for table in ("invoices", "documents"):
        op.drop_index(f"ix_{table}_archived_at", table_name=table)
        op.drop_column(table, "archived_at")
