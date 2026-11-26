"""GET /api/v1/health: database and Redis reachability, plus whether the schema is current."""

from functools import lru_cache
from pathlib import Path

import redis
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util import CommandError
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.logging import get_logger
from app.core.settings import Settings, get_settings
from app.db.session import get_engine

router = APIRouter(tags=["health"])
log = get_logger(__name__)


def _check_database() -> bool:
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError as exc:
        log.warning("health_database_failed", error_type=type(exc).__name__)
        return False


@lru_cache
def _expected_revision() -> str | None:
    """The newest Alembic revision this code was built with."""
    backend = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend / "app" / "db" / "migrations"))
    return ScriptDirectory.from_config(cfg).get_current_head()


def _check_schema() -> str:
    """ok when the database is at the code's head revision, outdated when it is behind (a
    migration was not applied), unknown when it cannot be told. Informational only: it never
    changes the health status, so a stale schema cannot take the app out of rotation."""
    try:
        expected = _expected_revision()
        with get_engine().connect() as conn:
            current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except (SQLAlchemyError, CommandError, OSError) as exc:
        log.warning("health_schema_unknown", error_type=type(exc).__name__)
        return "unknown"
    if current == expected:
        return "ok"
    log.warning("health_schema_outdated", current=current, expected=expected)
    return "outdated"


def _check_redis(url: str) -> bool:
    client = redis.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
    try:
        return bool(client.ping())
    except redis.RedisError as exc:
        log.warning("health_redis_failed", error_type=type(exc).__name__)
        return False
    finally:
        client.close()


@router.get("/health")
def health(settings: Settings = Depends(get_settings)) -> JSONResponse:
    checks = {
        "database": "ok" if _check_database() else "down",
        "redis": "ok" if _check_redis(settings.redis_url) else "down",
    }
    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        {"status": "ok" if healthy else "degraded", "checks": checks, "schema": _check_schema()},
        status_code=200 if healthy else 503,
    )
