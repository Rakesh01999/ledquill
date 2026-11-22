"""GET /api/v1/health: database and Redis reachability."""

import redis
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
        {"status": "ok" if healthy else "degraded", "checks": checks},
        status_code=200 if healthy else 503,
    )
