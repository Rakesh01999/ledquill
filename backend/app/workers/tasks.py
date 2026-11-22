"""Celery tasks. The signature carries ids only; all state lives in the database."""

from contextlib import closing
from uuid import UUID

from app.core.errors import TransientError
from app.db.session import new_session
from app.workers.celery_app import celery_app
from app.workers.stages import run_job


@celery_app.task(name="ledquill.ping")
def ping() -> str:
    return "pong"


@celery_app.task(name="ledquill.process_document", bind=True, acks_late=True, max_retries=3)
def process_document(self, document_id: str, job_id: str) -> str:
    """Run the ordered stage list for one document. Only transient errors are retried."""
    with closing(new_session()) as session:
        try:
            return run_job(
                session,
                UUID(document_id),
                UUID(job_id),
                final_attempt=self.request.retries >= self.max_retries,
            )
        except TransientError as exc:
            raise self.retry(exc=exc, countdown=min(5 * 2**self.request.retries, 120)) from exc
