"""Structured logging. Bind document_id / job_id with structlog.contextvars.bind_contextvars."""

import logging
import sys
import traceback

import structlog


def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None):
    return structlog.get_logger(name)


_MESSAGE_LIMIT = 300
_STACK_FRAMES = 15


def exception_fields(exc: BaseException) -> dict[str, str]:
    """`error_message` and `stack` for a log line about an unexpected exception.

    Never document text: a SQLAlchemy exception prints its SQL parameters, which are page text,
    so the driver's own message is used (`orig`) and anything from "[SQL:" on is dropped. The
    stack is frames only (file, line, function, source line), without values. The message is
    capped, because an exception from a parser can quote a short piece of what it parsed.
    """
    root = getattr(exc, "orig", None) or exc
    message = str(root).split("[SQL:")[0].strip()[:_MESSAGE_LIMIT]
    stack = "".join(traceback.format_tb(exc.__traceback__, limit=-_STACK_FRAMES))
    return {"error_message": message, "stack": stack}
