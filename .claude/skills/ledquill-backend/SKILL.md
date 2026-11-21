---
name: ledquill-backend
description: Conventions for LedQuill's Python backend. Use for any work in backend/ — FastAPI routers, Pydantic schemas, SQLAlchemy models, Alembic migrations, Celery tasks, storage, file uploads, auth, error handling, search queries, rate limiting, Docker or settings — even small changes like adding one endpoint or field.
---

# LedQuill Backend

## Structure and boundaries

- `api/` routers are thin: parse input, call a service function, return a schema.
  No SQL, no pipeline logic in routers.
- `services/` (create only when a router needs more than ~15 lines of logic)
  holds use cases: `upload_documents`, `correct_invoice`, `search_invoices`.
- `pipeline/` modules are pure functions where possible (input -> output), so
  they test without DB or network. Side effects live in `workers/tasks.py`.
- `db/` owns models and the session. One `get_session` dependency per request;
  workers open their own session per task and close it.
- `schemas/` is the contract: request/response models and the extraction model.

## FastAPI patterns

- App factory `create_app()`; routers mounted under `/api/v1`.
- Settings: one `Settings(BaseSettings)` cached with `lru_cache`; never read
  `os.environ` elsewhere.
- Auth dependency `require_api_key` applied at router level, not per handler;
  `/health` and `/docs` stay open.
- Responses always use `response_model`; never return ORM objects directly.
- Errors: raise `AppError(status, title, detail)`; one exception handler turns
  it into RFC 7807 JSON. Map Pydantic errors to 422 in the same format.
- Upload endpoint returns 202 quickly: validate, hash, store, insert rows,
  enqueue, return ids. Nothing slow in the request.

## Celery

- Task signature takes ids only (`process_document(document_id, job_id)`),
  never large payloads.
- `acks_late=True`, `autoretry_for` transient errors (network, 429, DB
  connection), `retry_backoff=True`, `max_retries=3`. Permanent errors (corrupt
  file, unsupported type) fail immediately with a reason — do not retry them.
- Each stage wrapped in a `stage(name)` context manager that writes
  `processing_events` (started/succeeded/failed + duration_ms) and updates
  `documents.progress`.
- Idempotent: re-running a task deletes and rebuilds that document's derived
  rows (pages, invoices) inside a transaction.
- Upstash in demo: `rediss://` URL with `ssl_cert_reqs=required`.

## Database

- SQLAlchemy 2.0 typed `Mapped[...]` models; UUID primary keys generated in app.
- `numeric(14,2)` money -> `Decimal`; never float in models or schemas.
- Transactions around multi-row writes (invoice + line items + issues).
- Queries: select only needed columns for lists; `selectinload` for detail
  views; always paginate lists (`limit` max 100, return `total`).
- Keyword search: `search_tsv @@ websearch_to_tsquery('english', :q)` ranked
  by `ts_rank`; supplier fuzzy match with `pg_trgm` `%` / `similarity`.
- Semantic: `embedding <=> :vec` (cosine) with HNSW index.
- Hybrid: reciprocal rank fusion, `score = sum(1 / (60 + rank))` across both lists.

## Uploads and storage

- Type detection by content (`filetype`), then allowlist:
  pdf, jpeg, png, tiff, xlsx, xls, csv (csv checked by decoding + sniffing).
- Limits from settings (25 MB per file, 20 files per request) -> 413 / 400.
- Storage key: `documents/{uuid}/{sanitized_name}`; never trust the client name
  for paths. `Storage` protocol with `LocalStorage` and `SupabaseStorage`;
  selected by `STORAGE_BACKEND`.
- Same sha256 already stored -> still accept, link to the new document, and
  let validation flag the duplicate (the reviewer must see it).

## Security checklist for every endpoint

- [ ] Auth dependency applied (or deliberately public)
- [ ] All input validated by a Pydantic model with bounds (lengths, ranges)
- [ ] No secrets or document text in logs or error responses
- [ ] Rate limit on upload and search (slowapi, per API key)
- [ ] CORS limited to `LEDQUILL_CORS_ORIGINS`

## Docker

- One backend image for api and worker (different commands). Install
  `tesseract-ocr`, `libgl1`, `poppler-utils` only if needed. Non-root user.
- `start.sh` for Render runs `celery worker --concurrency=1` in the background
  and `uvicorn` in the foreground; locally they are separate services.
