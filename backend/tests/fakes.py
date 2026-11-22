"""A scriptable fake LLM provider and helpers to build a client around it."""

import hashlib
import json
import math
import re
from dataclasses import dataclass
from typing import Any

import redis

from app.db.models import EMBEDDING_DIMS
from app.llm.base import Provider, Reply
from app.llm.cache import ResultCache
from app.llm.client import ExtractionClient
from app.llm.limiter import Limits, TokenBucket
from app.pipeline.embed import EmbeddingError

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
        prompt = self.tokens * 7 // 10
        text = item if isinstance(item, str) else json.dumps(item)
        return Reply(text, self.tokens, prompt, self.tokens - prompt)


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


# --- embeddings ---------------------------------------------------------------------------

# Words the stub treats as related, so a semantic query can match text it shares no word with.
RELATED = {"stationery": ("paper", "toner", "stapler"), "software": ("licence", "subscription")}


class StubEmbedder:
    """Deterministic 384-dim bag-of-words vectors: no model, no download, no network.
    Related words (RELATED) light the same buckets, so cosine similarity can rank by meaning."""

    def __init__(self, *_args, **_kwargs) -> None:
        self.passage_calls = 0
        self.query_calls = 0

    @staticmethod
    def _vector(text: str) -> list[float]:
        words = re.findall(r"[a-z0-9]+", text.lower())
        words += [r for w in words for r in RELATED.get(w, ())]
        vec = [0.0] * EMBEDDING_DIMS
        for word in words:
            vec[int(hashlib.sha256(word.encode()).hexdigest(), 16) % EMBEDDING_DIMS] += 1.0
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        self.passage_calls += 1
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        self.query_calls += 1
        return self._vector(text)


class FailingEmbedder:
    """An embedder whose model cannot load."""

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        raise EmbeddingError("OSError")

    def embed_query(self, text: str) -> list[float]:
        raise EmbeddingError("OSError")
