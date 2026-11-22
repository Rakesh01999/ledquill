"""Prompt-injection defence layer 1: instruction-like lines never reach the model or the
grounding source. This is a heuristic and not the only defence (the data block, the schema-only
output and the grounding check remain), so a missed phrasing is contained, not trusted."""

import re

_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|"
        r"all|any|your)\b[^.\n]{0,30}\b(?:instruction|prompt|rule|message|context)s?\b",
        r"\bsystem\s+prompt\b",
        r"\byou\s+are\s+now\b",
        r"\bnew\s+instructions?\s*:",
        r"\b(?:set|change|make|report|output)\s+(?:the\s+)?(?:total|subtotal|tax|amount)\b"
        r"[^.\n]{0,30}\b(?:to|as|equal)\b",
        r"\bas\s+an?\s+(?:ai|language\s+model|assistant)\b",
    )
]
REMOVED_MARKER = "[line removed: instruction-like text]"


def strip_injection(text: str) -> tuple[str, int]:
    """Replace instruction-like lines with a marker. Returns (clean text, lines removed)."""
    removed = 0
    lines = []
    for line in text.split("\n"):
        if any(p.search(line) for p in _PATTERNS):
            lines.append(REMOVED_MARKER)
            removed += 1
        else:
            lines.append(line)
    return "\n".join(lines), removed
