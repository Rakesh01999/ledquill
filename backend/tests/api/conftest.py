import pytest


@pytest.fixture(autouse=True)
def _clean_database(db_clean):
    """API tests start from empty tables."""
