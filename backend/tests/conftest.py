"""Shared fixtures. Tests need a Postgres and Redis (docker compose, or the CI services).

Tests run against their own `ledquill_test` database, created and migrated on demand, so
the development data in `ledquill` is never truncated. Celery runs eagerly.
"""

import os
import tempfile
from pathlib import Path

from sqlalchemy.engine import make_url

_DEFAULT_URL = "postgresql+psycopg://ledquill:ledquill@db:5432/ledquill"
_TEST_URL = make_url(os.environ.get("DATABASE_URL", _DEFAULT_URL)).set(database="ledquill_test")
# Must be set before any app module reads settings.
os.environ["DATABASE_URL"] = _TEST_URL.render_as_string(hide_password=False)
os.environ["LEDQUILL_API_KEY"] = "test-key"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["STORAGE_LOCAL_DIR"] = tempfile.mkdtemp(prefix="ledquill-test-")

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.core.settings import get_settings  # noqa: E402
from app.db.session import get_engine, new_session  # noqa: E402
from app.main import create_app  # noqa: E402
from app.workers.celery_app import celery_app  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
API_HEADERS = {"X-API-Key": "test-key"}

celery_app.conf.task_always_eager = True
celery_app.conf.task_eager_propagates = False


@pytest.fixture(scope="session", autouse=True)
def _test_database():
    admin = create_engine(_TEST_URL.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = 'ledquill_test'")
        ).scalar()
        if not exists:
            conn.execute(text("CREATE DATABASE ledquill_test"))
    admin.dispose()
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "app" / "db" / "migrations"))
    command.upgrade(cfg, "head")


@pytest.fixture
def db_clean():
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE documents CASCADE"))


@pytest.fixture
def db_session():
    session = new_session()
    yield session
    session.close()


@pytest.fixture
def app():
    application = create_app()
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
def client(app):
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES
