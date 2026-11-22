"""Per-API-key rate limits on upload and search (slowapi), so a client cannot exhaust the
service or the LLM budget. Limit strings come from settings, read on every request.

Counters live in this process's memory: they reset on restart and are not shared between API
replicas. That is enough for the single API instance this project deploys."""

import hashlib

from fastapi import Request
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import Response

from app.core.errors import problem
from app.core.settings import get_settings


def client_key(request: Request) -> str:
    """The caller's identity for limiting: a hash of its API key, else its address. The key
    itself is never stored or logged."""
    api_key = request.headers.get("x-api-key")
    if api_key:
        return "key:" + hashlib.sha256(api_key.encode()).hexdigest()[:16]
    return "ip:" + get_remote_address(request)


limiter = Limiter(key_func=client_key, storage_uri="memory://", headers_enabled=True)


def upload_limit() -> str:
    return get_settings().ledquill_rate_limit_upload


def search_limit() -> str:
    return get_settings().ledquill_rate_limit_search


def rate_limited(request: Request, exc: RateLimitExceeded) -> Response:
    """429 as RFC 7807 problem JSON with Retry-After (seconds)."""
    response = problem(429, f"Too many requests ({exc.detail}). Wait for Retry-After seconds.")
    view_limit = getattr(request.state, "view_rate_limit", None)
    return request.app.state.limiter._inject_headers(response, view_limit)  # noqa: SLF001
