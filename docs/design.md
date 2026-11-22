# LedQuill — System Design & Implementation Plan

Nov 21, 2026 · @Rakesh Biswas

This is SDLC phase 3 (design) and the start of phase 4 (implementation). It turns the [Requirements Analysis & Project Plan](requirements.md) into exact contracts: data model, API, pipeline, prompt and config. It also gives the build order with ready-to-paste Claude Code prompts.

How to use it: copy section 7 into the repo as `CLAUDE.md` first, then run the phases in section 6 in order. Each phase ends with a check you can see; do not start the next phase until it passes.

| Fact | Value |
| --- | --- |
| Product | LedQuill: read, extract, verify invoices |
| Repo | `ledquill` (public, GitHub) |
| Stack | FastAPI + Celery + PostgreSQL/pgvector + Redis + Next.js |
| LLM | Groq `openai/gpt-oss-120b` primary; `qwen/qwen3.8-27b`, `openai/gpt-oss-20b`, then `gemini-3.8-flash` as fallbacks |

## 1. Pipeline and lifecycle

One upload creates one `document` and one `job`. The worker runs six stages in order and records each one in `processing_events` (start, end, duration, detail), which gives the processing history and the timing numbers for the evaluation report.

| # | Stage | What happens | Tool | On failure |
| --- | --- | --- | --- | --- |
| 1 | Detect | Check real type by content, size limit, hash for duplicates | `filetype`, hashlib | Reject with reason, no retry |
| 2 | Extract | Digital PDF text per page; pages with under 50 characters are rendered at 300 DPI and OCR'd; spreadsheets read sheet by sheet | PyMuPDF, OpenCV + Tesseract, pandas | Corrupt or encrypted file: fail with reason |
| 3 | Split | Group pages into invoices: a page with an invoice-number pattern starts a new invoice, others join the previous one. Each spreadsheet row group (by invoice number) is one invoice | Python rules | Whole document treated as one invoice |
| 4 | Fields | Regex pass first, then the LLM fills gaps; every value must be found in the source text or it is set to null | Groq, Gemini | Retry with next model; after all fail, keep rule results and flag review |
| 5 | Validate | Rules V-01 to V-09, duplicates, cross-checks | Python rules | Never fails; it only records issues |
| 6 | Index | Full-text vector and embedding saved | Postgres tsvector, fastembed | Retry; search still works by keyword |

A 1,000-page PDF is read page by page (never loaded whole), progress is updated every 10 pages, and stage 4 runs per invoice, so one bad invoice never fails the whole document.

```mermaid
stateDiagram-v2
  [*] --> Queued
  Queued --> Processing
  Processing --> Failed: 3 retries fail
  Failed --> Queued: reprocess
  Processing --> Ready: rules pass
  Processing --> NeedsReview: rules fail
  Ready --> Approved: approve
  NeedsReview --> Approved: fix
```

Statuses. Document job: `queued`, `processing`, `completed`, `failed`. Invoice: `needs_review` (any Error, two or more Warnings, or low confidence), `ready` (all rules pass), `approved` (a person approved it, or fixed it and it passed again). A fix re-runs validation automatically. Celery retries a job 3 times with backoff before `failed`; reprocess puts it back to `queued`.

## 2. Database schema

Eight tables in PostgreSQL. Money is `numeric(14,2)`, never float. Duplicates are stored and flagged, not blocked, so the reviewer sees them. Managed with SQLAlchemy models and Alembic migrations; this is the target shape.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- one uploaded file
CREATE TABLE documents (
  id            uuid PRIMARY KEY,
  filename      text NOT NULL,
  file_type     text NOT NULL,          -- pdf | image | xlsx | xls | csv
  mime_type     text NOT NULL,
  sha256        char(64) NOT NULL,      -- same file uploaded twice = same hash
  size_bytes    bigint NOT NULL,
  storage_key   text NOT NULL,          -- path in local volume or Supabase bucket
  page_count    int,
  status        text NOT NULL DEFAULT 'queued',  -- queued|processing|completed|failed
  progress      int  NOT NULL DEFAULT 0,          -- 0-100
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- one processing attempt (first run or reprocess)
CREATE TABLE jobs (
  id            uuid PRIMARY KEY,
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind          text NOT NULL,          -- process | reprocess
  status        text NOT NULL,
  attempts      int  NOT NULL DEFAULT 0,
  current_stage text,
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz
);

-- text of each page or sheet
CREATE TABLE pages (
  id            uuid PRIMARY KEY,
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_no       int  NOT NULL,          -- sheet index for spreadsheets
  method        text NOT NULL,          -- text | ocr | sheet
  text          text,
  ocr_confidence real,
  UNIQUE (document_id, page_no)
);

-- one extracted invoice (a document can hold many)
CREATE TABLE invoices (
  id               uuid PRIMARY KEY,
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_numbers     int[],
  invoice_number   text,
  invoice_date     date,
  supplier_name    text,
  customer_name    text,
  currency         char(3),
  subtotal         numeric(14,2),
  tax              numeric(14,2),
  total            numeric(14,2),
  confidence       jsonb NOT NULL DEFAULT '{}',  -- {"total": 0.97, ...}
  raw_extraction   jsonb,                        -- rules + LLM output, for audit
  method           text,                         -- rules | llm | rules+llm
  model            text,                         -- which LLM answered
  status           text NOT NULL DEFAULT 'needs_review', -- needs_review|ready|approved
  supplier_norm    text,                         -- lowercased, trimmed, for duplicates
  search_text      text,                         -- fields + line items as one string
  search_tsv       tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text,''))) STORED,
  embedding        vector(384),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE line_items (
  id           uuid PRIMARY KEY,
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no      int NOT NULL,
  description  text,
  quantity     numeric(14,4),
  unit_price   numeric(14,4),
  amount       numeric(14,2)
);

-- every failed rule, with what was expected
CREATE TABLE validation_issues (
  id                 uuid PRIMARY KEY,
  invoice_id         uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  rule_id            text NOT NULL,     -- V-01 ... V-09
  severity           text NOT NULL,     -- error | warning
  field              text,
  expected           text,
  actual             text,
  message            text NOT NULL,
  related_invoice_id uuid REFERENCES invoices(id),  -- duplicate or cross-check partner
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- audit trail of manual fixes
CREATE TABLE corrections (
  id           uuid PRIMARY KEY,
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  field        text NOT NULL,
  old_value    text,
  new_value    text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- processing history and timings
CREATE TABLE processing_events (
  id           bigserial PRIMARY KEY,
  document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  job_id       uuid REFERENCES jobs(id) ON DELETE CASCADE,
  stage        text NOT NULL,           -- detect|extract|split|fields|validate|index
  status       text NOT NULL,           -- started|succeeded|failed
  duration_ms  int,
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON documents (sha256);
CREATE INDEX ON documents (status, created_at DESC);
CREATE INDEX ON invoices (supplier_norm, invoice_number);
CREATE INDEX ON invoices (invoice_date);
CREATE INDEX ON invoices (total);
CREATE INDEX ON invoices (status);
CREATE INDEX ON invoices USING gin (search_tsv);
CREATE INDEX ON invoices USING gin (supplier_name gin_trgm_ops);
CREATE INDEX ON invoices USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON processing_events (document_id, created_at);
```

Why this shape: `pages` keeps raw text so reprocessing can skip OCR; `raw_extraction` keeps what the model said, for audit; `confidence` as JSON avoids one column per field; trigram index makes supplier search typo-tolerant; HNSW gives fast semantic search without a separate vector DB.

## 3. API specification

Base path `/api/v1`. JSON everywhere except upload. FastAPI generates the full OpenAPI spec at `/docs`, which is the reference the reviewer can click through.

| Method | Path | Purpose | Task |
| --- | --- | --- | --- |
| POST | `/documents` | Upload one or many files (multipart `files[]`); returns 202 with document and job ids | Upload |
| GET | `/documents` | List with filters `status`, `file_type`, `limit`, `offset` | Status |
| GET | `/documents/{id}` | Metadata, status, progress, invoice ids | Status |
| GET | `/documents/{id}/events` | Processing history with stage timings | History |
| POST | `/documents/{id}/reprocess` | Re-queue a failed or finished document | Reprocess |
| GET | `/jobs/{id}` | Job status, stage, attempts, error | Status |
| GET | `/invoices` | Keyword filters: `supplier`, `invoice_number`, `date_from`, `date_to`, `min_total`, `max_total`, `currency`, `status`, `q` | Results, search |
| GET | `/invoices/{id}` | Fields, confidence, line items, issues, corrections, source pages | Results |
| PATCH | `/invoices/{id}` | Manual correction of fields or line items; logs a correction and re-validates | Corrections |
| POST | `/invoices/{id}/approve` | Mark approved | Review |
| GET | `/search` | `q` + `mode` = `keyword`, `semantic` or `hybrid` (default); returns ranked invoices with score | Search |
| GET | `/stats` | Counts by status, success and failure rates, average time per stage | Dashboard |
| GET | `/health` | Database and Redis reachability (200 ok, 503 degraded) | Ops |

Rules that apply to every endpoint:

- **Auth:** header `X-API-Key`, compared in constant time. The browser never holds the key: Next.js server routes call the API and add it. `/health` is public so orchestrators can probe it; it returns no sensitive data.
- **Errors:** RFC 7807 problem JSON (`type`, `title`, `status`, `detail`), consistent codes: 400 bad input, 401 no key, 404 not found, 409 conflict, 413 file too large, 415 unsupported type, 422 validation, 429 rate limited.
- **Uploads:** max 25 MB per file and 20 files per request (configurable); type checked by content, not extension; filenames sanitized; stored under a generated key.
- **Pagination:** `limit` (max 100) and `offset`, response includes `total`.
- **Hybrid search:** keyword rank (`ts_rank`) and vector similarity combined with reciprocal rank fusion, so exact invoice numbers and meaning-based queries both work.
- **Rate limit:** per-key limit on upload and search (slowapi) to protect the service and the LLM rate limits.

## 4. Extraction prompt and anti-hallucination rules

This prompt is a deliverable (`docs/prompts.md`) and lives in code as a versioned constant (`PROMPT_VERSION = "extract-v1"`), stored with every result so accuracy can be tied to a prompt version.

**System prompt**

```text
You extract invoice data from OCR or PDF text. Return ONLY one JSON object that
matches the schema. Rules:
1. Use only information written in the text. Never guess, infer or calculate a
   value that is not printed. If a field is missing or unreadable, use null.
2. Copy invoice_number, supplier_name and customer_name exactly as printed.
3. Dates: ISO 8601 (YYYY-MM-DD). If the day/month order is ambiguous, use null
   and set confidence below 0.5.
4. Amounts: plain numbers, no currency symbols or thousands separators.
5. currency: ISO 4217 code (BDT, USD, EUR...) only if a symbol or code is printed.
6. Supplier = the party issuing the invoice; customer = the party billed.
7. confidence: 0 to 1 per field, your certainty that the value is printed and
   read correctly. Use null values with confidence 0.
8. line_items: every printed line; omit a sub-field that is not printed.
```

**User message:** `Hints from rules: {rule_hints_json}` followed by `Text (pages {pages}):` and the trimmed page text (capped at about 6K tokens).

**Output schema** (validated with Pydantic; anything else is rejected and retried once):

```json
{
  "invoice_number": "string|null", "invoice_date": "YYYY-MM-DD|null",
  "supplier_name": "string|null", "customer_name": "string|null",
  "currency": "AAA|null", "subtotal": "number|null", "tax": "number|null", "total": "number|null",
  "line_items": [{"description": "string", "quantity": "number|null", "unit_price": "number|null", "amount": "number|null"}],
  "confidence": {"invoice_number": 0.0, "invoice_date": 0.0, "supplier_name": 0.0, "customer_name": 0.0,
                 "currency": 0.0, "subtotal": 0.0, "tax": 0.0, "total": 0.0}
}
```

Three defences against invented values, in code, not just in the prompt:

1. **Grounding check:** every returned number and name must appear in the source text (numbers after normalising separators, names by fuzzy match). A value not found is replaced with null and its confidence set to 0.
2. **Rules agree or flag:** when the regex pass and the LLM disagree on a field, keep the LLM value only if it is grounded, lower confidence to 0.6 and let rule V-08 flag it.
3. **No arithmetic fill-in:** the model never computes a missing total; validation compares printed numbers only.

Provider call settings: `temperature 0`, JSON response format, `reasoning_effort low` and `include_reasoning false` for gpt-oss. Order: `openai/gpt-oss-120b` → `qwen/qwen3.8-27b` → `openai/gpt-oss-20b` → `gemini-3.8-flash`. A per-model token bucket (8K TPM, 200K TPD) decides before calling; a 429 moves to the next model; results are cached by `sha256(text + PROMPT_VERSION)`.

## 5. Configuration and environments

All settings come from environment variables, read once by a Pydantic `Settings` class. The repo ships `.env.example` with these keys and no values; the real `.env` is in `.gitignore`.

```bash
# app
LEDQUILL_ENV=local                 # local | demo | test
LEDQUILL_API_KEY=                  # long random string; openssl rand -hex 32
LEDQUILL_MAX_UPLOAD_MB=25
LEDQUILL_MAX_FILES_PER_REQUEST=20
LEDQUILL_CORS_ORIGINS=http://localhost:3000

# data
DATABASE_URL=postgresql+psycopg://ledquill:ledquill@db:5432/ledquill
REDIS_URL=redis://redis:6379/0
STORAGE_BACKEND=local              # local | supabase
STORAGE_LOCAL_DIR=/data/uploads
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_BUCKET=documents

# llm
GROQ_API_KEY=
GEMINI_API_KEY=
LLM_MODELS=groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b,groq:openai/gpt-oss-20b,gemini:gemini-3.8-flash
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5

# frontend (Next.js server side only)
LEDQUILL_API_URL=http://api:8000
```

| Setting | Local (`docker compose up`) | Live demo |
| --- | --- | --- |
| Services | `db` (pgvector/pgvector:pg16), `redis`, `api`, `worker`, `web` | Vercel (web), Render (api + worker in one container) |
| Database | Local Postgres container | Supabase, Session pooler URL |
| Redis | Local container | Upstash `rediss://` URL; Celery needs `ssl_cert_reqs=required` for TLS |
| Files | Docker volume | Supabase Storage bucket `documents` |
| Worker | Own container, concurrency 2 | Started by `start.sh` beside uvicorn, concurrency 1 |

The app code is identical in both; only `.env` changes. That is the point of ADR-002.

## 6. Implementation plan

The specs live in `docs/requirements.md` and `docs/design.md`. Claude Code reads only the sections a phase names, which saves tokens every session.

| Phase | When | Builds | Done when |
| --- | --- | --- | --- |
| P0 Scaffold | Sat, now | Repo layout, Docker Compose, settings, health, Celery ping, migrations, CI | `docker compose up` works, `/api/v1/health` is green, CI passes |
| P1 Ingestion | Sat afternoon | Upload, storage, detect, PDF text, OCR, spreadsheets, events, progress | Each fixture file produces `pages` rows; a corrupt file ends `failed` with a reason |
| P2 Extraction | Sat evening | Split, regex rules, LLM providers, grounding, validation | A sample invoice produces correct fields and the right issues; tests use a mocked LLM |
| P3 Dataset | Sat night | Synthetic labeled invoices, clean and degraded | About 60 files plus `labels.json` in `evaluation/data` |
| P4 API + search | Sun morning | All endpoints, corrections, reprocess, embeddings, hybrid search, stats | Every endpoint visible in `/docs`, API tests pass |
| P5 Frontend | Sun afternoon | Upload, documents, invoice review and edit, search, dashboard | Full flow works in the browser |
| P6 Tests + eval | Sun evening | Failure tests, evaluation script, report | `evaluation/report.md` with measured numbers, CI green |
| P7 Deploy | Sun night (smoke), Mon morning | Render, Vercel, Supabase, Upstash | Live link processes one PDF end to end |
| P8 Ship | Mon | README, diagrams, prompts, AI disclosure, video, email | Deliverables checklist all ticked |

Rules for every session: one phase per session, start each with the phase prompt, end with tests passing and a commit, then open a fresh session.

**P0 prompt**

```text
Read CLAUDE.md, docs/design.md sections 2, 3 and 5. Scaffold the repo exactly as
CLAUDE.md describes: backend (FastAPI app factory, Pydantic Settings from env,
/api/v1/health checking DB and Redis), Celery app with a ping task, SQLAlchemy 2
models and an Alembic migration for the full schema in design.md section 2,
docker-compose.yml with db (pgvector/pgvector:pg16), redis, api, worker, a
Dockerfile with tesseract-ocr installed, .env.example, .gitignore, ruff and
pytest config, and a GitHub Actions workflow running ruff and pytest against a
Postgres service. Leave frontend/ empty for now. Show me the commands to verify.
```

**P1 prompt**

```text
Phase P1 (see docs/design.md section 1, stages 1-2). Implement:
- storage interface with Local and Supabase backends
- POST /api/v1/documents (multi-file, size and count limits, type check by content,
  sha256, 202 response) that creates document + job and enqueues the Celery task
- pipeline/detect.py, pipeline/pdf.py (PyMuPDF per page, OCR fallback under 50 chars),
  pipeline/ocr.py (OpenCV grayscale, deskew, denoise, threshold, Tesseract with
  confidence), pipeline/sheets.py (all sheets of xlsx/xls, csv encoding detection)
- processing_events per stage with duration, progress updates every 10 pages
- clear failure for corrupt or encrypted files
Create small fixtures in backend/tests/fixtures (digital pdf, scanned png, tiff,
xlsx with 2 sheets, csv, corrupt pdf) and unit tests for each. Run the tests.
```

**P2 prompt**

```text
Phase P2 (docs/design.md sections 1 stages 3-5 and 4; docs/requirements.md
section 7). Implement pipeline/split.py, pipeline/rules.py (regex pre-extraction),
llm/ providers (Groq OpenAI-compatible, Gemini) behind one interface with the
model order from LLM_MODELS, per-model token bucket, 429 failover, cache by hash,
prompt exactly as design.md section 4 with PROMPT_VERSION, Pydantic output
validation, grounding check, and pipeline/validate.py with rules V-01 to V-09
(tolerance 0.01 or 0.5%). Save invoices, line items and issues, set status.
Tests must mock the LLM; add one opt-in live test marked @pytest.mark.live.
```

**P3 prompt**

```text
Phase P3. Write evaluation/generate.py that creates about 60 labeled test files
with reportlab and Pillow from random but realistic invoice data (several
suppliers, currencies BDT/USD/EUR, 1-12 line items): clean digital PDFs, scanned
versions (rotation up to 3 degrees, blur, noise, low contrast) as PNG/JPG/TIFF,
one multi-invoice PDF, invoices with missing fields, wrong totals and duplicates,
and an xlsx register that matches some PDFs with a few deliberate mismatches.
Write ground truth to evaluation/data/labels.json. Use a fixed random seed.
```

**P4 prompt**

```text
Phase P4 (docs/design.md section 3). Implement every remaining endpoint with
X-API-Key auth, RFC 7807 errors, pagination, PATCH corrections that log to
corrections and re-run validation, approve, reprocess, keyword filters, fastembed
embeddings at index stage, /search with keyword, semantic and hybrid (reciprocal
rank fusion), /stats, and slowapi rate limits. API tests for each endpoint,
including 401, 404, 413, 415 and 422 cases.
```

**P5 prompt**

```text
Phase P5. Build frontend/ with Next.js (App Router, TypeScript, Tailwind,
shadcn/ui, TanStack Query). Next.js route handlers proxy to the API and add the
API key server side; the browser never sees it. Pages: Upload (drag and drop,
many files, per-file progress), Documents (status chips, auto-refresh while
processing), Invoice detail (fields with confidence colours, source text beside
it, issues list, inline edit and save, approve), Review queue (needs_review
first), Search (mode toggle, filters), Dashboard (counts and rates from /stats).
Clean, professional, responsive; light and dark mode.
```

**P6 prompt**

```text
Phase P6. Add failure tests (corrupt, encrypted, empty, oversized, wrong type,
LLM down, all models rate limited, duplicate upload). Write evaluation/run_eval.py:
upload every file in evaluation/data through the API, wait for results, compare
with labels.json (exact match for ids and dates, numeric match within 0.01,
normalised fuzzy match for names, line items by amount), and write
evaluation/results.json and evaluation/report.md with per-field accuracy,
overall accuracy, document success and failure rate, and p50/p95 time per stage.
Report real measured numbers only.
```

## 7. Claude Code setup and git workflow

Claude Code rules live in `CLAUDE.md` (repo root, loaded every session) and four project skills in `.claude/skills/` (`ledquill-backend`, `ledquill-ai-extraction`, `ledquill-ui-design`, `ledquill-testing-eval`), loaded only when a task needs them. `.claude/settings.json` blocks reading `.env` files and running git commit or push. For UI work Anthropic's `frontend-design` skill is used alongside `ledquill-ui-design`.

Git workflow, kept simple:

- Work on `main`, one commit per finished step, pushed often. Commit messages follow Conventional Commits: `feat(pipeline): add OCR fallback`, `test(api): cover 415`, `docs: add prompts`.
- Tag the end of each day: `v0.1-day1`, `v0.2-day2`, `v1.0` at submission, so the reviewer can see real progress.
- Before every commit run `git status` and check that no `.env` file or key is staged.

Not in this doc on purpose: the deployment guide (P7) and the submission pack (P8). We write those on Nov 22 once the app runs, so they describe what was actually built.
