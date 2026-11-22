"""Result cache in Redis, keyed by sha256(text + hints + PROMPT_VERSION).

Only validated extraction results are stored: never failures, invalid output, or the document
text. The key is a hash, so the text cannot be recovered from Redis.
"""

import hashlib
import json

import redis
from pydantic import ValidationError

from app.core.logging import get_logger
from app.llm.prompts import PROMPT_VERSION
from app.schemas.extraction import ExtractionResult

log = get_logger(__name__)


def cache_key(text: str, hints_json: str) -> str:
    digest = hashlib.sha256("\x00".join((text, hints_json, PROMPT_VERSION)).encode()).hexdigest()
    return f"llm:cache:{digest}"


class ResultCache:
    def __init__(self, client: redis.Redis, ttl_seconds: int) -> None:
        self._redis = client
        self._ttl = ttl_seconds

    def get(self, key: str) -> tuple[ExtractionResult, str] | None:
        """(result, model that produced it), or None. Any cache fault is a miss."""
        try:
            raw = self._redis.get(key)
            if raw is None:
                return None
            payload = json.loads(raw)
            return ExtractionResult.model_validate(payload["result"]), str(payload["model"])
        except (redis.RedisError, ValueError, KeyError, TypeError, ValidationError):
            log.warning("llm_cache_read_failed")
            return None

    def put(self, key: str, result: ExtractionResult, model: str) -> None:
        payload = json.dumps({"model": model, "result": result.model_dump(mode="json")})
        try:
            self._redis.set(key, payload, ex=self._ttl)
        except redis.RedisError:
            log.warning("llm_cache_write_failed")
