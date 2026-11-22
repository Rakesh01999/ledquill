"""Shared fixtures. Tests need a Postgres and Redis (docker compose, or the CI services).

Tests run against their own `ledquill_test` database, created and migrated on demand, so
the development data in `ledquill` is never truncated. Celery runs eagerly.
"""

import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy.engine import make_url

_DEFAULT_URL = "postgresql+psycopg://ledquill:ledquill@db:5432/ledquill"
_TEST_URL = make_url(os.environ.get("DATABASE_URL", _DEFAULT_URL)).set(database="ledquill_test")
# Must be set before any app module reads settings.
os.environ["DATABASE_URL"] = _TEST_URL.render_as_string(hide_password=False)
os.environ["LEDQUILL_API_KEY"] = "test-key"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["LEDQUILL_RATE_LIMIT_UPLOAD"] = "10000/minute"  # tests upload constantly
os.environ["LEDQUILL_RATE_LIMIT_SEARCH"] = "10000/minute"
os.environ["STORAGE_LOCAL_DIR"] = tempfile.mkdtemp(prefix="ledquill-test-")

import pytest  # noqa: E402
import redis  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.core.ratelimit import limiter  # noqa: E402
from app.core.settings import get_settings  # noqa: E402
from app.db.session import get_engine, new_session  # noqa: E402
from app.main import create_app  # noqa: E402
from app.pipeline import embed  # noqa: E402
from app.workers import stages  # noqa: E402
from app.workers.celery_app import celery_app  # noqa: E402
from tests.fakes import FakeProvider, StubEmbedder, make_client  # noqa: E402

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


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture(autouse=True)
def stub_embedder(monkeypatch):
    """The real model is never loaded or downloaded: get_embedder() builds a StubEmbedder."""
    monkeypatch.setattr(embed, "FastEmbedder", StubEmbedder)
    embed.get_embedder.cache_clear()
    yield
    embed.get_embedder.cache_clear()


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


LLM_TEST_REDIS_DB = 15  # never DB 0: that is the Celery broker


@pytest.fixture
def llm_redis(settings):
    """Redis DB 15 for the limiter and cache, flushed before and after each test."""
    url = urlsplit(settings.redis_url)._replace(path=f"/{LLM_TEST_REDIS_DB}").geturl()
    client = redis.Redis.from_url(url)
    assert client.connection_pool.connection_kwargs["db"] == LLM_TEST_REDIS_DB
    client.flushdb()
    yield client
    client.flushdb()
    client.close()


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch, llm_redis) -> FakeProvider:
    """No test reaches a real provider: the worker gets a client around this FakeProvider.
    Unscripted, it answers with a valid JSON that found nothing."""
    provider = FakeProvider()
    client = make_client(llm_redis, provider)
    monkeypatch.setattr(stages, "build_llm_client", lambda _settings: client)
    provider.client = client
    return provider


def pytest_collection_modifyitems(config, items):
    if "1" in (os.environ.get("RUN_LIVE"), os.environ.get("RUN_LIVE_LLM")):
        return
    skip = pytest.mark.skip(reason="live LLM test: set RUN_LIVE_LLM=1 (or RUN_LIVE=1) to run")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)
