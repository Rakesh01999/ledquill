"""Celery application."""

from celery import Celery

from app.core.settings import get_settings

_settings = get_settings()

celery_app = Celery(
    "ledquill",
    broker=_settings.redis_url,
    backend=_settings.redis_url,
    include=["app.workers.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
)
