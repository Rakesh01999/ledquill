"""API-key authentication (X-API-Key, constant-time compare)."""

import hmac

from fastapi import Depends, Header

from app.core.errors import AppError
from app.core.settings import Settings, get_settings


def require_api_key(
    x_api_key: str | None = Header(default=None), settings: Settings = Depends(get_settings)
) -> None:
    """Fail closed: with no configured key, every request is refused."""
    expected = settings.ledquill_api_key
    if not expected or x_api_key is None:
        raise AppError(401, "Missing or invalid API key")
    if not hmac.compare_digest(x_api_key.encode(), expected.encode()):
        raise AppError(401, "Missing or invalid API key")
