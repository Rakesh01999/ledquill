"""Celery tasks. Pipeline tasks arrive in later phases."""

from app.workers.celery_app import celery_app


@celery_app.task(name="ledquill.ping")
def ping() -> str:
    return "pong"
