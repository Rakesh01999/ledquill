#!/bin/bash
# Render runs the API and one Celery worker in this container. If either process exits,
# the container exits too, so the platform restarts it instead of serving with a dead worker.
set -u

celery -A app.workers.celery_app worker --concurrency=1 --loglevel=info &
uvicorn app.main:create_app --factory --host 0.0.0.0 --port "${PORT:-8000}" &

wait -n
status=$?
echo "start.sh: a process exited with status ${status}; stopping the container" >&2
kill 0 2>/dev/null
exit "${status}"
