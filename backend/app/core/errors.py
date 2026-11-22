"""RFC 7807 problem+json error handling, registered once on the app."""

from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

PROBLEM_JSON = "application/problem+json"
log = get_logger(__name__)


def problem(status: int, detail: str, errors: list | None = None) -> JSONResponse:
    body: dict = {
        "type": "about:blank",
        "title": HTTPStatus(status).phrase,
        "status": status,
        "detail": detail,
    }
    if errors:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, media_type=PROBLEM_JSON)


async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return problem(exc.status_code, str(exc.detail))


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return problem(422, "Request validation failed", errors)


async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled_error", path=request.url.path, error_type=type(exc).__name__)
    return problem(500, "Internal server error")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _unhandled_error)
