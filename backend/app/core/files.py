"""Filename and storage-key helpers. Client-supplied names are never used as paths."""

import re
import unicodedata
import uuid

_UNSAFE = re.compile(r"[^A-Za-z0-9._ -]+")
MAX_NAME_LENGTH = 100


def sanitize_filename(raw: str | None) -> str:
    """Reduce a client filename to a safe, short display name (no directories)."""
    name = unicodedata.normalize("NFKC", raw or "")
    name = re.split(r"[\\/]", name)[-1]  # drop any directory part, either separator style
    name = _UNSAFE.sub("_", name).strip(" .")
    name = re.sub(r"\.{2,}", ".", name)
    if len(name) > MAX_NAME_LENGTH:
        stem, dot, ext = name.rpartition(".")
        keep = MAX_NAME_LENGTH - len(ext) - 1 if dot and len(ext) <= 10 else MAX_NAME_LENGTH
        name = f"{stem[:keep]}.{ext}" if dot and len(ext) <= 10 else name[:MAX_NAME_LENGTH]
    return name or "file"


def storage_key(document_id: uuid.UUID, filename: str) -> str:
    return f"documents/{document_id}/{filename}"
