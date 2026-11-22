"""A scriptable fake LLM provider and helpers to build a client around it."""

import json
from dataclasses import dataclass
from typing import Any

import redis

from app.llm.base import Provider, Reply
from app.llm.cache import ResultCache
from app.llm.client import ExtractionClient
from app.llm.limiter import Limits, TokenBucket

EMPTY = {"confidence": {}}  # a valid answer that found nothing


@dataclass
class Call:
    model: str
    system: str
    user: str


class FakeProvider:
    """Returns scripted replies in order (a dict, a JSON string, or an exception to raise),
    then `default`. Records every call."""

    def __init__(self, name: str = "groq", default: Any = EMPTY, tokens: int = 100) -> None:
        self.name = name
        self.default = default
        self.tokens = tokens
        self.queue: list[Any] = []
        self.calls: list[Call] = []

    def script(self, *items: Any) -> "FakeProvider":
        self.queue.extend(items)
        return self

    def complete(self, model: str, system: str, user: str, *, timeout: float) -> Reply:
        self.calls.append(Call(model, system, user))
        item = self.queue.pop(0) if self.queue else self.default
        if isinstance(item, Exception):
            raise item
        return Reply(item if isinstance(item, str) else json.dumps(item), self.tokens)


def llm_json(confidence: float = 0.95, **fields: Any) -> dict:
    """A model answer: the given fields, each with `confidence`."""
    return {**fields, "confidence": {name: confidence for name in fields if name != "line_items"}}


def make_client(
    redis_client: redis.Redis,
    *providers: Provider,
    chain: tuple[str, ...] | None = None,
    tpm: int = 8000,
    tpd: int = 200_000,
) -> ExtractionClient:
    by_name = {p.name: p for p in providers}
    chain = chain or tuple(f"{p.name}:model-{p.name}" for p in providers)
    return ExtractionClient(
        chain=list(chain),
        providers=by_name,
        limiter=TokenBucket(redis_client, {n: Limits(tpm, tpd) for n in by_name}, 0.9),
        cache=ResultCache(redis_client, 3600),
        timeout=5.0,
    )
