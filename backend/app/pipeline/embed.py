"""Text embeddings for semantic search (FR-19): fastembed with BAAI/bge-small-en-v1.5.

The model is loaded on first use, once per process, never at import or startup. Callers get an
`Embedder` from `get_embedder()`, which is None when semantic search is disabled, so tests and
memory-limited deploys can swap or skip it."""

import threading
from functools import lru_cache
from typing import Protocol

from app.core.logging import get_logger
from app.core.settings import get_settings
from app.db.models import EMBEDDING_DIMS

log = get_logger(__name__)
MAX_CHARS = 4000  # bge-small reads 512 tokens; more text is dead weight


class EmbeddingError(Exception):
    """The model could not load or run. The message is safe to store and show: it names the
    failure type only, never document text."""


class Embedder(Protocol):
    def embed_passages(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class FastEmbedder:
    def __init__(self, model_name: str, cache_dir: str) -> None:
        self._model_name = model_name
        self._cache_dir = cache_dir
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._model is None:
                from fastembed import TextEmbedding  # heavy import, only when first needed

                self._model = TextEmbedding(self._model_name, cache_dir=self._cache_dir)
            return self._model

    def _run(self, texts: list[str], *, query: bool) -> list[list[float]]:
        try:
            model = self._load()
            clipped = [t[:MAX_CHARS] for t in texts]
            vectors = model.query_embed(clipped) if query else model.passage_embed(clipped)
            out = [[float(x) for x in v] for v in vectors]
        except Exception as exc:  # noqa: BLE001 - third-party failures (network, ONNX, disk)
            log.warning("embedding_failed", error_type=type(exc).__name__)
            raise EmbeddingError(type(exc).__name__) from exc
        if any(len(v) != EMBEDDING_DIMS for v in out):
            raise EmbeddingError(f"unexpected vector size, wanted {EMBEDDING_DIMS}")
        return out

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        return self._run(texts, query=False)

    def embed_query(self, text: str) -> list[float]:
        return self._run([text], query=True)[0]


@lru_cache
def get_embedder() -> Embedder | None:
    """The process-wide embedder, or None when LEDQUILL_SEMANTIC_ENABLED is false."""
    settings = get_settings()
    if not settings.ledquill_semantic_enabled:
        return None
    return FastEmbedder(settings.embedding_model, settings.embedding_cache_dir)
