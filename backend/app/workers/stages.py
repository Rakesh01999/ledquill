"""Ordered stage list and the runner that records events, progress and failures.

Later phases add stages by appending to STAGES; progress is the weighted share of
completed stages, so nothing else needs rebalancing by hand.
"""

import hashlib
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from time import perf_counter
from uuid import UUID

import structlog
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import PermanentError, TransientError
from app.core.logging import get_logger
from app.core.settings import Settings, get_settings
from app.db.models import Document, Invoice, Job, Page, ProcessingEvent
from app.llm.client import ExtractionClient, build_llm_client
from app.pipeline import embed
from app.pipeline.detect import HEAD_BYTES, detect
from app.pipeline.embed import EmbeddingError
from app.pipeline.extract import Limits, extract
from app.pipeline.fields import extract_fields, fallback_outcome
from app.pipeline.split import PageText, Segment, split_document
from app.storage import Storage, get_storage
from app.workers.invoices import delete_document_invoices, save_invoice, validate_invoice

PAGE_BATCH = 10  # commit pages and update progress every N pages
_HASH_CHUNK = 1024 * 1024
log = get_logger(__name__)


@dataclass
class StageContext:
    session: Session
    document: Document
    job: Job
    settings: Settings
    storage: Storage
    span_start: float = 0.0  # percent of overall progress where the running stage begins
    span_size: float = 0.0  # percent of overall progress the running stage covers
    final_attempt: bool = False  # no Celery retries left: degrade instead of raising
    segments: list[Segment] = field(default_factory=list)  # set by split, read by fields
    llm: ExtractionClient | None = None  # built on first use; unusable-provider state is per job

    def set_progress(self, fraction: float) -> None:
        """Report progress within the running stage (0..1) as overall document progress."""
        pct = self.span_start + self.span_size * min(max(fraction, 0.0), 1.0)
        self.document.progress = min(int(pct), 99)  # 100 is reserved for job completion


@dataclass(frozen=True)
class Stage:
    name: str
    run: Callable[[StageContext], dict]
    weight: int
    optional: bool = False  # an EmbeddingError is recorded as a failed event; the job goes on


def run_detect(ctx: StageContext) -> dict:
    """Re-check the stored file with the same detect() the upload endpoint used."""
    doc = ctx.document
    digest, size = hashlib.sha256(), 0
    with ctx.storage.local_path(doc.storage_key) as path, path.open("rb") as fh:
        head = fh.read(HEAD_BYTES)
        digest.update(head)
        size = len(head)
        while chunk := fh.read(_HASH_CHUNK):
            digest.update(chunk)
            size += len(chunk)
    detected = detect(head)
    if size > ctx.settings.max_upload_bytes:
        raise PermanentError(
            f"The file is larger than the {ctx.settings.ledquill_max_upload_mb} MB limit."
        )
    if detected.file_type != doc.file_type or digest.hexdigest() != doc.sha256:
        raise PermanentError("The stored file does not match what was uploaded.")
    return {"file_type": detected.file_type, "mime_type": detected.mime_type, "size_bytes": size}


def run_extract(ctx: StageContext) -> dict:
    """Write one `pages` row per PDF page, image frame or sheet."""
    doc, session = ctx.document, ctx.session
    session.execute(delete(Page).where(Page.document_id == doc.id))  # idempotent re-run
    session.commit()
    settings = ctx.settings
    limits = Limits(
        settings.ledquill_max_pdf_pages,
        settings.ledquill_max_tiff_frames,
        settings.ledquill_max_image_pixels,
    )
    counts = {"text": 0, "ocr": 0, "sheet": 0}
    confidences: list[float] = []
    with ctx.storage.local_path(doc.storage_key) as path:
        extraction = extract(path, doc.file_type, limits)
        done = 0
        for page in extraction.pages:
            session.add(
                Page(
                    document_id=doc.id,
                    page_no=page.page_no,
                    method=page.method,
                    text=page.text,
                    ocr_confidence=page.ocr_confidence,
                )
            )
            counts[page.method] += 1
            if page.ocr_confidence is not None:
                confidences.append(page.ocr_confidence)
            done += 1
            if done % PAGE_BATCH == 0 or done == extraction.total:
                ctx.set_progress(done / extraction.total)
                session.commit()
    doc.page_count = done
    session.commit()
    detail: dict = {"pages": done, **{f"{k}_pages": v for k, v in counts.items() if v}}
    if confidences:
        detail["mean_ocr_confidence"] = round(sum(confidences) / len(confidences), 1)
    return detail


def run_split(ctx: StageContext) -> dict:
    """Group the stored page text into invoice segments and clear the previous run's invoices."""
    session, doc = ctx.session, ctx.document
    pages = session.scalars(
        select(Page).where(Page.document_id == doc.id).order_by(Page.page_no)
    ).all()
    ctx.segments = split_document([PageText(p.page_no, p.method, p.text or "") for p in pages])
    delete_document_invoices(session, doc.id)  # idempotent re-run
    session.commit()
    return {"invoices": len(ctx.segments)}


def run_fields(ctx: StageContext) -> dict:
    """Rules, LLM and grounding per invoice. One failing invoice never fails the document."""
    session, doc = ctx.session, ctx.document

    def get_llm() -> ExtractionClient:
        if ctx.llm is None:
            ctx.llm = build_llm_client(ctx.settings)
        return ctx.llm

    methods: dict[str, int] = {}
    total = len(ctx.segments)
    for done, segment in enumerate(ctx.segments, start=1):
        try:
            outcome = extract_fields(segment, get_llm, final_attempt=ctx.final_attempt)
        except TransientError:
            raise
        except Exception as exc:  # one bad invoice must not fail the whole document
            log.error("invoice_extraction_failed", error_type=type(exc).__name__)
            outcome = fallback_outcome(segment, "error")
        save_invoice(session, doc, segment, outcome)
        session.commit()  # keep finished invoices if a later one raises a transient error
        methods[outcome.method] = methods.get(outcome.method, 0) + 1
        ctx.set_progress(done / total)
    return {"invoices": total, **{f"{k}_invoices": v for k, v in methods.items()}}


def run_validate(ctx: StageContext) -> dict:
    """V-01..V-09 for every invoice of the document. Never fails; it only records issues."""
    session, doc = ctx.session, ctx.document
    invoices = session.scalars(
        select(Invoice).where(Invoice.document_id == doc.id).order_by(Invoice.created_at)
    ).all()
    issue_count = 0
    for invoice in invoices:
        issue_count += len(validate_invoice(session, invoice, doc))
        session.commit()
    ready = sum(1 for i in invoices if i.status == "ready")
    return {
        "invoices": len(invoices),
        "ready": ready,
        "needs_review": len(invoices) - ready,
        "issues": issue_count,
    }


def run_index(ctx: StageContext) -> dict:
    """Embed each invoice's search text for semantic search. Keyword search needs no vector, so a
    model failure raises EmbeddingError, which this optional stage records without failing."""
    session, doc = ctx.session, ctx.document
    embedder = embed.get_embedder()
    if embedder is None:
        return {"embedded": 0, "skipped": "semantic search is disabled"}
    invoices = session.scalars(
        select(Invoice).where(Invoice.document_id == doc.id).order_by(Invoice.created_at)
    ).all()
    todo = [i for i in invoices if i.search_text]
    if todo:
        vectors = embedder.embed_passages([i.search_text for i in todo])
        try:
            for invoice, vector in zip(todo, vectors, strict=True):
                invoice.embedding = vector
            session.commit()
        except SQLAlchemyError as exc:  # a failed vector write must not fail the job
            session.rollback()
            raise EmbeddingError(type(exc).__name__) from exc
    return {"embedded": len(todo), "invoices": len(invoices)}


STAGES: list[Stage] = [
    Stage("detect", run_detect, weight=1),
    Stage("extract", run_extract, weight=6),
    Stage("split", run_split, weight=1),
    Stage("fields", run_fields, weight=10),
    Stage("validate", run_validate, weight=2),
    Stage("index", run_index, weight=1, optional=True),
]


@contextmanager
def stage_events(ctx: StageContext, name: str) -> Iterator[dict]:
    """Write started/succeeded/failed events with duration_ms around one stage."""
    session, doc, job = ctx.session, ctx.document, ctx.job
    job.current_stage = name
    session.add(ProcessingEvent(document_id=doc.id, job_id=job.id, stage=name, status="started"))
    session.commit()
    began = perf_counter()
    detail: dict = {}
    try:
        yield detail
    except BaseException as exc:
        session.rollback()
        shown = isinstance(exc, PermanentError | EmbeddingError)
        detail["error"] = str(exc) if shown else type(exc).__name__
        _add_event(ctx, name, "failed", began, detail)
        raise
    _add_event(ctx, name, "succeeded", began, detail)


def _add_event(ctx: StageContext, name: str, status: str, began: float, detail: dict) -> None:
    ctx.session.add(
        ProcessingEvent(
            document_id=ctx.document.id,
            job_id=ctx.job.id,
            stage=name,
            status=status,
            duration_ms=int((perf_counter() - began) * 1000),
            detail=detail or None,
        )
    )
    ctx.session.commit()


def _fail(session: Session, doc: Document, job: Job, message: str) -> None:
    session.rollback()
    doc.status = "failed"
    doc.error = message
    job.status = "failed"
    job.error = message
    job.finished_at = datetime.now(UTC)
    session.commit()


def run_job(session: Session, document_id: UUID, job_id: UUID, **kwargs) -> str:
    """Run every stage in order (see `_run_job`), with document_id and job_id on every log line."""
    structlog.contextvars.bind_contextvars(document_id=str(document_id), job_id=str(job_id))
    try:
        return _run_job(session, document_id, job_id, **kwargs)
    finally:
        structlog.contextvars.unbind_contextvars("document_id", "job_id")


def _run_job(
    session: Session,
    document_id: UUID,
    job_id: UUID,
    *,
    final_attempt: bool,
    stages: Sequence[Stage] | None = None,
    storage: Storage | None = None,
    settings: Settings | None = None,
) -> str:
    """Run every stage in order. Returns "completed" or "failed".

    Permanent errors fail the job at once. Transient errors are re-raised for Celery to
    retry, unless this is the final attempt, in which case the job fails with a reason.
    """
    doc, job = session.get(Document, document_id), session.get(Job, job_id)
    if doc is None or job is None:
        log.warning("job_target_missing", document_id=str(document_id), job_id=str(job_id))
        return "missing"
    bound = log.bind(document_id=str(doc.id), job_id=str(job.id))
    if job.status == "failed":  # superseded by a reprocess while it waited in the queue
        bound.info("job_skipped_superseded")
        return "superseded"
    stages = STAGES if stages is None else stages
    ctx = StageContext(
        session,
        doc,
        job,
        settings or get_settings(),
        storage or get_storage(),
        final_attempt=final_attempt,
    )
    job.status, job.attempts, job.error = "processing", job.attempts + 1, None
    job.started_at = job.started_at or datetime.now(UTC)
    doc.status, doc.error = "processing", None
    session.commit()

    total_weight = sum(s.weight for s in stages)
    done_weight = 0
    try:
        for stage in stages:
            ctx.span_start = 100 * done_weight / total_weight
            ctx.span_size = 100 * stage.weight / total_weight
            try:
                with stage_events(ctx, stage.name) as detail:
                    detail.update(stage.run(ctx))
            except EmbeddingError as exc:
                if not stage.optional:
                    raise
                bound.warning("optional_stage_failed", stage=stage.name, reason=str(exc))
            done_weight += stage.weight
            doc.progress = (
                int(100 * done_weight / total_weight) if done_weight < total_weight else 99
            )
            session.commit()
    except PermanentError as exc:
        bound.info("job_failed", stage=job.current_stage, reason=str(exc))
        _fail(session, doc, job, str(exc))
        return "failed"
    except (TransientError, OperationalError) as exc:
        bound.warning("job_transient_error", stage=job.current_stage, error_type=type(exc).__name__)
        if not final_attempt:
            session.rollback()
            raise TransientError(type(exc).__name__) from exc
        _fail(session, doc, job, "Processing failed after several attempts. Please reprocess.")
        return "failed"
    except Exception as exc:  # last line of defence: a bad file must never crash the worker
        bound.error("job_unexpected_error", stage=job.current_stage, error_type=type(exc).__name__)
        _fail(session, doc, job, "Unexpected error while processing this file.")
        return "failed"

    doc.status, doc.progress, doc.error = "completed", 100, None
    job.status, job.finished_at = "completed", datetime.now(UTC)
    session.commit()
    bound.info("job_completed", pages=doc.page_count)
    return "completed"
