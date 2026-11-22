"""limit/offset query parameters shared by every list endpoint (max 100, design.md section 3)."""

from dataclasses import dataclass

from fastapi import Query

MAX_LIMIT = 100


@dataclass(frozen=True)
class PageParams:
    limit: int
    offset: int


def page_params(
    limit: int = Query(25, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0, le=1_000_000),
) -> PageParams:
    return PageParams(limit, offset)
