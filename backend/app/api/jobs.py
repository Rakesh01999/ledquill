"""GET /jobs/{id}: status, stage, attempts and error of one processing attempt."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import require_api_key
from app.db.models import Job
from app.db.session import get_session
from app.schemas.documents import JobOut

router = APIRouter(prefix="/jobs", tags=["jobs"], dependencies=[Depends(require_api_key)])


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: uuid.UUID, session: Session = Depends(get_session)):
    job = session.get(Job, job_id)
    if job is None:
        raise AppError(404, "Job not found.")
    return job
