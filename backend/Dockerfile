# Stages: base (runtime) -> dev (adds test and lint tools, used by docker compose) -> prod
# (default, last stage: what Render builds).
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# tesseract for OCR; libgl1/libglib2.0-0 are runtime needs of OpenCV (added in P1)
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 app \
    && mkdir -p /app /data/uploads /data/models \
    && chown -R app:app /app /data

WORKDIR /app

FROM base AS dev
COPY requirements.txt requirements-dev.txt ./
RUN pip install -r requirements-dev.txt
COPY --chown=app:app . .
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS prod
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY --chown=app:app . .
RUN chmod +x start.sh
USER app
EXPOSE 8000
CMD ["./start.sh"]
