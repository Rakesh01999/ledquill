"""Storage on a local directory (Docker volume). Files are never served from here."""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from app.core.errors import PermanentError


class LocalStorage:
    def __init__(self, base_dir: str) -> None:
        self.base = Path(base_dir).resolve()

    def _path(self, key: str) -> Path:
        path = (self.base / key).resolve()
        if not path.is_relative_to(self.base):
            raise ValueError("storage key escapes the storage directory")
        return path

    def save(self, key: str, chunks: Iterator[bytes]) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("wb") as fh:
                for chunk in chunks:
                    fh.write(chunk)
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    @contextmanager
    def local_path(self, key: str) -> Iterator[Path]:
        path = self._path(key)
        if not path.is_file():
            raise PermanentError("The uploaded file is no longer in storage.")
        yield path

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)
