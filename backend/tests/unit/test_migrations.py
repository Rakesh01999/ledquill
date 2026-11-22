"""Requires `alembic upgrade head` to have run against the test database."""

from sqlalchemy import inspect

from app.db.models import Base
from app.db.session import get_engine

EXPECTED_TABLES = {
    "documents",
    "jobs",
    "pages",
    "invoices",
    "line_items",
    "validation_issues",
    "corrections",
    "processing_events",
}


def test_models_define_all_eight_tables():
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_migration_created_all_tables():
    existing = set(inspect(get_engine()).get_table_names())
    assert existing >= EXPECTED_TABLES


def test_money_columns_are_numeric_not_float():
    insp = inspect(get_engine())
    cols = {c["name"]: c["type"] for c in insp.get_columns("invoices")}
    for name in ("subtotal", "tax", "total"):
        assert type(cols[name]).__name__ == "NUMERIC"
        assert cols[name].precision == 14 and cols[name].scale == 2
