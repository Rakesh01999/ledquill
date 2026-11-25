"""Text that PostgreSQL can store."""

import re

_LONE_SURROGATES = re.compile("[\ud800-\udfff]")


def clean_text(text: str) -> str:
    """Remove NUL (0x00) and replace lone surrogates with U+FFFD.

    PostgreSQL text cannot hold a NUL, and a lone surrogate cannot be encoded as UTF-8; either
    one makes the database driver refuse the whole statement. Every other character, including
    tabs, form feeds and other control characters, is returned unchanged.
    """
    if "\x00" in text:
        text = text.replace("\x00", "")
    return _LONE_SURROGATES.sub("�", text)
