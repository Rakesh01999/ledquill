import uuid

import pytest

from app.core.errors import PermanentError
from app.core.files import MAX_NAME_LENGTH, sanitize_filename, storage_key
from app.storage.local import LocalStorage


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("invoice.pdf", "invoice.pdf"),
        ("../../etc/passwd", "passwd"),
        ("C:\\Users\\x\\inv 1.pdf", "inv 1.pdf"),
        ("inv<script>.pdf", "inv_script_.pdf"),
        ("...hidden", "hidden"),
        ("", "file"),
        (None, "file"),
        ("\u202e.exe", "_.exe"),
    ],
)
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected


def test_long_names_are_shortened_but_keep_the_extension():
    name = sanitize_filename("a" * 300 + ".pdf")
    assert len(name) <= MAX_NAME_LENGTH and name.endswith(".pdf")


def test_storage_key_is_generated_not_client_controlled():
    doc_id = uuid.uuid4()
    assert storage_key(doc_id, "x.pdf") == f"documents/{doc_id}/x.pdf"


def test_local_storage_round_trip_and_delete(tmp_path):
    storage = LocalStorage(str(tmp_path))
    storage.save("documents/a/x.bin", iter([b"ab", b"cd"]))
    with storage.local_path("documents/a/x.bin") as path:
        assert path.read_bytes() == b"abcd"
    storage.delete("documents/a/x.bin")
    with pytest.raises(PermanentError), storage.local_path("documents/a/x.bin"):
        pass


def test_failed_save_leaves_no_partial_file(tmp_path):
    storage = LocalStorage(str(tmp_path))

    def chunks():
        yield b"partial"
        raise RuntimeError("limit crossed")

    with pytest.raises(RuntimeError):
        storage.save("documents/a/x.bin", chunks())
    assert not (tmp_path / "documents" / "a" / "x.bin").exists()


def test_keys_cannot_escape_the_storage_directory(tmp_path):
    with pytest.raises(ValueError, match="escapes"):
        LocalStorage(str(tmp_path)).save("../outside.bin", iter([b"x"]))
