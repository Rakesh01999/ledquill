"""File storage behind one small protocol; backend chosen by STORAGE_BACKEND."""

from collections.abc import Iterator
from contextlib import AbstractContextManager
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.core.settings import get_settings


class Storage(Protocol):
    def save(self, key: str, chunks: Iterator[bytes]) -> None:
        """Write the chunks under key. A failure (including one raised by the chunk
        iterator, e.g. a size limit) must leave no object behind."""

    def local_path(self, key: str) -> AbstractContextManager[Path]:
        """Yield a readable local file for key; temporary copies are removed on exit."""

    def delete(self, key: str) -> None: ...


@lru_cache
def get_storage() -> Storage:
    settings = get_settings()
    if settings.storage_backend == "supabase":
        from app.storage.supabase import SupabaseStorage

        return SupabaseStorage(
            settings.supabase_url, settings.supabase_service_key, settings.supabase_bucket
        )
    from app.storage.local import LocalStorage

    return LocalStorage(settings.storage_local_dir)
