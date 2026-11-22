"""Supabase Storage via its REST API (httpx). Not exercised by automated tests."""

import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

import httpx

from app.core.errors import PermanentError, TransientError

_CHUNK = 1024 * 1024


class SupabaseStorage:
    def __init__(self, url: str, service_key: str, bucket: str) -> None:
        self._base = f"{url.rstrip('/')}/storage/v1/object"
        self._bucket = bucket
        self._headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}

    def _url(self, key: str) -> str:
        return f"{self._base}/{self._bucket}/{quote(key)}"

    def save(self, key: str, chunks: Iterator[bytes]) -> None:
        # Spool to disk first: the request then carries an explicit Content-Length and the
        # caller's size limit is enforced before anything leaves this host.
        with tempfile.TemporaryFile() as tmp:
            size = 0
            for chunk in chunks:
                tmp.write(chunk)
                size += len(chunk)
            tmp.seek(0)
            headers = {**self._headers, "Content-Length": str(size), "x-upsert": "true"}
            try:
                resp = httpx.post(
                    self._url(key),
                    headers=headers,
                    content=iter(lambda: tmp.read(_CHUNK), b""),
                    timeout=120,
                )
            except httpx.TransportError as exc:
                raise TransientError("storage upload failed") from exc
        if resp.status_code >= 500:
            raise TransientError(f"storage upload failed with {resp.status_code}")
        resp.raise_for_status()

    @contextmanager
    def local_path(self, key: str) -> Iterator[Path]:
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "download"
            try:
                with (
                    httpx.stream("GET", self._url(key), headers=self._headers, timeout=120) as r,
                    target.open("wb") as fh,
                ):
                    if r.status_code in (400, 404):
                        raise PermanentError("The uploaded file is no longer in storage.")
                    if r.status_code >= 500:
                        raise TransientError(f"storage download failed with {r.status_code}")
                    r.raise_for_status()
                    for chunk in r.iter_bytes(_CHUNK):
                        fh.write(chunk)
            except httpx.TransportError as exc:
                raise TransientError("storage download failed") from exc
            yield target

    def delete(self, key: str) -> None:
        try:
            httpx.delete(self._url(key), headers=self._headers, timeout=30)
        except httpx.TransportError as exc:
            raise TransientError("storage delete failed") from exc
