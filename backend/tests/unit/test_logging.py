"""exception_fields: what the unexpected-error log line says, and what it must never say."""

import psycopg
import pytest
from sqlalchemy.exc import DataError, StatementError

from app.core.logging import exception_fields
from app.workers.stages import Stage, run_job
from tests.helpers import create_document

PAGE_TEXT = "ACME confidential page text " * 20


def caught(make_exception) -> BaseException:
    try:
        raise make_exception()
    except BaseException as exc:  # noqa: BLE001 - the test inspects whatever was raised
        return exc


def driver_data_error() -> DataError:
    orig = psycopg.DataError("PostgreSQL text fields cannot contain NUL (0x00) bytes")
    return DataError("INSERT INTO pages (text) VALUES (%(text)s)", {"text": PAGE_TEXT}, orig)


def test_message_is_the_drivers_not_the_sql_with_its_parameters():
    exc = caught(driver_data_error)
    assert "ACME confidential" in str(exc)  # the default text would have leaked the page
    fields = exception_fields(exc)
    assert fields["error_message"] == "PostgreSQL text fields cannot contain NUL (0x00) bytes"
    assert "ACME confidential" not in fields["error_message"] + fields["stack"]


def test_sqlalchemy_error_without_an_original_drops_the_sql_and_parameters():
    exc = caught(
        lambda: StatementError(
            "A value is required for bind parameter", "SELECT 1", {"t": PAGE_TEXT}, None
        )
    )
    assert "ACME confidential" in str(exc)
    fields = exception_fields(exc)
    assert fields["error_message"] == "A value is required for bind parameter"
    assert "ACME confidential" not in fields["error_message"] + fields["stack"]


def test_message_is_capped_at_300_characters():
    fields = exception_fields(caught(lambda: ValueError("x" * 1000)))
    assert fields["error_message"] == "x" * 300


def test_stack_is_frames_only():
    marker = "ACME confidential local value"

    def inner():
        value = marker  # noqa: F841 - a local that a full traceback renderer could show
        raise RuntimeError("boom")

    fields = exception_fields(caught(inner))
    assert "test_logging.py" in fields["stack"] and "inner" in fields["stack"]
    assert marker not in fields["stack"]


def test_unexpected_error_log_line_has_the_message_and_the_stack(
    db_clean, db_session, fixtures_dir, capsys
):
    def run(ctx):
        raise ZeroDivisionError("division by zero")

    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")
    run_job(
        db_session, doc.id, job.id, final_attempt=False, stages=[Stage("detect", run, weight=1)]
    )

    out = capsys.readouterr().out
    line = next(ln for ln in out.splitlines() if "job_unexpected_error" in ln)
    # The renderer depends on whether another test configured logging first (console key=value
    # lines, or one JSON line), so the checks look for the pieces, not the exact layout.
    assert "ZeroDivisionError" in line
    assert "error_message" in line and "division by zero" in line
    assert "test_logging.py" in out and "in run" in out  # a frame of the stack


@pytest.mark.parametrize("exc", [KeyError("k"), OSError("disk"), TypeError("t")])
def test_any_exception_gives_both_fields(exc):
    assert set(exception_fields(caught(lambda: exc))) == {"error_message", "stack"}
