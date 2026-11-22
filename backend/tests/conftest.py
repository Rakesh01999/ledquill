"""Shared fixtures. Tests expect DATABASE_URL and REDIS_URL to point at running services
(docker compose, or the CI service containers)."""

import pytest
from fastapi.testclient import TestClient

from app.core.settings import get_settings
from app.main import create_app


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
