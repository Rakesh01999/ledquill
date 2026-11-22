"""Worker stage runner against the real test database and local storage."""

import pymupdf
import pytest
from sqlalchemy import func, select

from app.core.errors import TransientError
from app.db.models import Document, Job, Page, ProcessingEvent
from app.workers import stages
from app.workers.stages import STAGES, Stage, StageContext, run_job
from tests.helpers import create_document

pytestmark = pytest.mark.usefixtures("db_clean")


def events(session, document):
    rows = session.scalars(
        select(ProcessingEvent)
        .where(ProcessingEvent.document_id == document.id)
        .order_by(ProcessingEvent.id)
    )
    return [(e.stage, e.status) for e in rows]


def reload(session, document, job):
    session.expire_all()
    return session.get(Document, document.id), session.get(Job, job.id)


def test_stage_list_is_ordered():
    assert [s.name for s in STAGES] == ["detect", "extract", "split", "fields", "validate"]


def test_digital_pdf_completes_with_events_pages_and_durations(db_session, fixtures_dir):
    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")
    assert run_job(db_session, doc.id, job.id, final_attempt=False) == "completed"
    doc, job = reload(db_session, doc, job)
    assert (doc.status, doc.progress, doc.page_count, doc.error) == ("completed", 100, 2, None)
    assert (job.status, job.attempts) == ("completed", 1)
    assert events(db_session, doc) == [
        (stage, status)
        for stage in ("detect", "extract", "split", "fields", "validate")
        for status in ("started", "succeeded")
    ]
    finished = db_session.scalars(
        select(ProcessingEvent).where(ProcessingEvent.status == "succeeded")
    ).all()
    assert all(e.duration_ms is not None and e.duration_ms >= 0 for e in finished)
    assert next(e for e in finished if e.stage == "extract").detail["pages"] == 2
    pages = db_session.scalars(select(Page).order_by(Page.page_no)).all()
    assert [(p.page_no, p.method) for p in pages] == [(1, "text"), (2, "text")]


def test_progress_is_reported_every_ten_pages(db_session, tmp_path, monkeypatch):
    big = pymupdf.open()
    for n in range(25):
        big.new_page().insert_text((72, 96), f"Page {n} " + "invoice line " * 12, fontsize=12)
    path = tmp_path / "big.pdf"
    big.save(path)
    doc, job = create_document(db_session, path)

    seen = []
    original = StageContext.set_progress

    def spy(self, fraction):
        original(self, fraction)
        if self.job.current_stage == "extract":
            seen.append((round(fraction, 2), self.document.progress))

    monkeypatch.setattr(StageContext, "set_progress", spy)
    run_job(db_session, doc.id, job.id, final_attempt=False)
    assert [f for f, _ in seen] == [0.4, 0.8, 1.0]  # after pages 10, 20 and 25
    assert [p for _, p in seen] == sorted(p for _, p in seen)
    assert db_session.scalar(select(func.count()).select_from(Page)) == 25


def test_rerunning_a_job_does_not_duplicate_pages(db_session, fixtures_dir):
    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")
    run_job(db_session, doc.id, job.id, final_attempt=False)
    run_job(db_session, doc.id, job.id, final_attempt=False)
    assert db_session.scalar(select(func.count()).select_from(Page)) == 2
    _, job = reload(db_session, doc, job)
    assert job.attempts == 2


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("corrupt.pdf", "no readable pages"),
        ("encrypted.pdf", "This PDF is password protected."),
    ],
)
def test_unreadable_file_fails_at_once_with_a_plain_reason(db_session, fixtures_dir, name, reason):
    doc, job = create_document(db_session, fixtures_dir / name)
    assert run_job(db_session, doc.id, job.id, final_attempt=False) == "failed"  # no exception
    doc, job = reload(db_session, doc, job)
    assert doc.status == job.status == "failed"
    assert reason in doc.error and doc.error == job.error
    assert job.attempts == 1
    assert ("extract", "failed") in events(db_session, doc)


def test_empty_file_fails_in_the_detect_stage(db_session, fixtures_dir):
    doc, job = create_document(db_session, fixtures_dir / "empty.pdf")
    run_job(db_session, doc.id, job.id, final_attempt=False)
    doc, _ = reload(db_session, doc, job)
    assert doc.status == "failed" and doc.error == "The file is empty."
    assert events(db_session, doc)[-1] == ("detect", "failed")


def test_file_that_no_longer_matches_its_hash_fails_detect(db_session, fixtures_dir):
    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")
    doc.sha256 = "0" * 64
    db_session.commit()
    run_job(db_session, doc.id, job.id, final_attempt=False)
    doc, _ = reload(db_session, doc, job)
    assert doc.status == "failed" and "does not match" in doc.error


def flaky_stage(error):
    def run(ctx):
        raise error

    return [Stage("detect", run, weight=1)]


def test_transient_error_is_raised_for_retry_and_job_is_not_failed(db_session, fixtures_dir):
    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")
    with pytest.raises(TransientError):
        run_job(
            db_session,
            doc.id,
            job.id,
            final_attempt=False,
            stages=flaky_stage(TransientError("net")),
        )
    doc, job = reload(db_session, doc, job)
    assert job.status == "processing" and doc.status == "processing" and doc.error is None


def test_transient_error_on_final_attempt_fails_with_a_reason(db_session, fixtures_dir):
    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")
    outcome = run_job(
        db_session, doc.id, job.id, final_attempt=True, stages=flaky_stage(TransientError("net"))
    )
    doc, job = reload(db_session, doc, job)
    assert outcome == "failed" and doc.status == "failed"
    assert "after several attempts" in doc.error


def test_unexpected_exception_fails_the_job_without_crashing_the_worker(db_session, fixtures_dir):
    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")
    outcome = run_job(
        db_session, doc.id, job.id, final_attempt=False, stages=flaky_stage(ZeroDivisionError())
    )
    doc, _ = reload(db_session, doc, job)
    assert outcome == "failed" and doc.error == "Unexpected error while processing this file."


def test_progress_follows_stage_weights(db_session, fixtures_dir):
    doc, job = create_document(db_session, fixtures_dir / "digital.pdf")
    marks = []
    three = [
        Stage(name, lambda ctx, n=name: marks.append((n, ctx.span_start, ctx.span_size)) or {}, w)
        for name, w in (("detect", 1), ("extract", 2), ("split", 1))
    ]
    run_job(db_session, doc.id, job.id, final_attempt=False, stages=three)
    assert marks == [("detect", 0, 25), ("extract", 25, 50), ("split", 75, 25)]


def test_missing_document_is_ignored(db_session):
    import uuid

    assert run_job(db_session, uuid.uuid4(), uuid.uuid4(), final_attempt=False) == "missing"


def test_module_exposes_page_batch_of_ten():
    assert stages.PAGE_BATCH == 10
