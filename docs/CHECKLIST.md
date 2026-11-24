# LedQuill — Project Progress

Single place to track progress. Updated at the end of every phase, committed with the work.

**Legend:** `[ ]` to do · `[x]` done · `~~[ ] item~~` deliberately cut (reason noted, see requirements.md §14)

Specs: [requirements.md](requirements.md) (FR/NFR ids) · [design.md](design.md) (phases, contracts) · [prd.md](prd.md) (user stories, screens)

---

## Setup and planning

- [x] Requirements analysis and project plan (`docs/requirements.md`)
- [x] System design and implementation plan (`docs/design.md`)
- [x] Product requirements: user stories, flows, screens (`docs/prd.md`)
- [x] External services provisioned and API access verified (Groq, Gemini, Supabase, Upstash, Render, Vercel)
- [x] Claude Code setup: `CLAUDE.md`, project skills, safety settings
- [x] `.gitignore`
- [ ] Fallback model `gemini-3.8-flash` tested with a live call
- [x] UI mockups for Documents, Invoice review, Search

## P0 — Scaffold

- [x] Repository layout as in `CLAUDE.md`
- [x] Pydantic settings from environment, `.env.example`
- [x] FastAPI app factory, `/api/v1/health` (DB + Redis)
- [x] Celery app with ping task
- [x] SQLAlchemy models and Alembic migration for the full schema
- [x] `docker-compose.yml`: db (pgvector), redis, api, worker
- [x] Dockerfile with Tesseract
- [x] Ruff and pytest configuration
- [ ] GitHub Actions CI (ruff + pytest with Postgres)
- [x] **Gate:** `docker compose up` works, health is green, CI passes (CI green and integration tests per file type pass, confirmed manually)

## P1 — Ingestion

- [x] Storage interface: local and Supabase backends — LocalStorage and SupabaseStorage both verified end to end (P7)
- [x] `POST /documents`: multi-file upload, size/count limits, type by content, sha256, 202 response (FR-01, FR-02)
- [x] Digital PDF text extraction per page (FR-03)
- [x] OCR with preprocessing for scans and images, incl. multi-frame TIFF (FR-04)
- [x] XLSX, XLS and CSV parsing, all sheets (FR-05)
- [x] Corrupt and encrypted files fail with a clear reason (FR-06)
- [x] Processing events per stage with timings; progress updates
- [x] Fixtures and unit tests for each file type
- [x] **Gate:** every fixture produces page text; a corrupt file ends `failed` with a reason

## P2 — Extraction and validation

- [x] Multi-invoice PDF splitting (FR-07)
- [x] Rules-based pre-extraction
- [x] LLM providers with failover, token buckets, cache (FR-08)
- [x] Versioned prompt and Pydantic output validation
- [x] Grounding check: unfound values become null (FR-09)
- [x] Validation rules V-01 to V-08 (FR-10, FR-11, FR-12)
- [x] Review flag with reasons (FR-13)
- [x] Cross-verification PDF-PDF and PDF-Excel, V-09 (FR-14)
- [x] Tests with mocked LLM; one opt-in live test (live run: Groq call and grounding worked; its final assertion was fixed afterwards and not re-run, see report)
- [x] **Gate:** a sample invoice yields correct fields and the expected issues (total-mismatch case verified by hand)

## P3 — Labeled dataset

- [x] Generator with fixed seed (`evaluation/generate.py`)
- [x] Clean PDFs, degraded scans, multi-invoice PDF, missing fields, wrong totals, duplicates, Excel register
- [x] Ground truth in `evaluation/data/labels.json`
- [ ] A few real public invoices with hand-made labels
- [x] **Gate:** about 60 labeled files (58 files, 65 invoices, 12 MB; `evaluation/check_dataset.py` passes)

## P4 — API and search

- [x] Document list, detail, events; job status (FR-15)
- [x] Invoice list with keyword filters (FR-18)
- [x] Invoice detail; PATCH corrections with audit trail and re-validation (FR-15, FR-21)
- [x] Approve; reprocess failed jobs (FR-15)
- [x] Embeddings at index stage; semantic and hybrid search (FR-19); stub embedder in tests, real model measured once (see report)
- [x] `/stats`; RFC 7807 errors (401, 404, 405, 422, 429, 500 verified)
- [x] Rate limiting on upload and search, with Retry-After
- [x] Reprocess of a stale document; `DELETE /documents/{id}`; `LEDQUILL_SEMANTIC_ENABLED` switch
- [x] API tests incl. 401, 404, 413, 415, 422
- [x] **Gate:** every endpoint documented in `/docs`, API tests pass (462 passed, 1 skipped)

## P5 — Frontend

- [x] App shell, design tokens, light and dark mode (C1: shell, tokens, proxy, typed client; screens follow)
- [x] Documents: multi-upload with live per-file progress (FR-20) (C2: upload, list, polling, detail with page text and image, reprocess, delete; verified in Edge against the running stack)
- [x] Invoice review: source beside fields, confidence, issues, inline edit, approve (FR-20) (C3: verified in Edge; line items are read-only)
- [x] Review queue (C3: /invoices?sort=severity, count badge, queue Prev/Next)
- [x] Search with filters (C3: hybrid search and keyword filters; mode toggle cut, hybrid only)
- [x] Dashboard (C4: figures and tables from /stats only; matches the review badge and documents counts; no trend chart, as agreed)
- [x] Loading, empty, error states on every view (C4: checked against a stand-in API for empty, 500 and 429 with Retry-After)
- [ ] Performance budget met (prd.md §8)
- [x] Accessibility and responsive checks (C4: one focus ring, 474 tab stops audited, 36 size/theme/page combinations at 390 / 820 / 1440 px; 375 / 768 / 1280 / 1536 not run)
- [ ] **Gate:** full flow works in the browser

## P6 — Tests and evaluation

- [x] Failure scenario tests (corrupt, encrypted, empty, oversized, wrong type, LLM down, rate-limited, duplicate): existing and new tests pass (500 passed, 2 skipped); duplicate upload pinned in `test_duplicate_upload.py`
- [x] Evaluation script through the real API (`evaluation/run_eval.py`) and labeled dataset (`evaluation/data`, 58 files): full run done, 58 of 58 files (see `evaluation/report.md`)
- [x] `evaluation/results.json` and `evaluation/report.md` with measured accuracy, timing, success and failure rates
- [x] Test results saved in evaluation/ (results.json, report.md)
- [ ] Reuse stored pages on job retry instead of re-running OCR: not implemented: retry deletes page rows and re-runs OCR (backend/app/workers/stages.py run_extract); listed as a known limitation
- [ ] Document in README: V-07/V-09 flag only the later-processed invoice; same-hash duplicates with no invoice row are not caught (README is written in P8)
- [x] `run_eval` uploads files with `depends_on` sequentially and waits for the partner to complete: sequential; each file waits for terminal status; a failed partner does not block the dependent file (a note is printed)
- [x] Estimate LLM token use for ~60 files against daily limits: measured: 68,662 tokens across 50 files (about 70K), under the earlier ~100K estimate
- [ ] Live Gemini failover test (`tests/live`, opt-in `RUN_LIVE_LLM=1`, gemini-3.8-flash): not confirmed, provider overload (503 three times); failover covered by fake-provider tests
- ~~[ ] 1000-page PDF test~~ cut from scope: not tested (page limit is enforced; rate limits and demo hosting limits apply)
- ~~[ ] Lighthouse run~~ cut from scope: not measured
- [x] **Gate:** CI green, report contains only measured numbers: CI green (confirmed on GitHub); report numbers verified against results.json

## P7 — Deployment

- [x] Supabase schema migrated; SupabaseStorage verified end to end
- [x] Production image (`prod` target) and `backend/start.sh` (API + one Celery worker in one container)
- [x] Memory measured locally under 512 MB / 0.1 CPU: worst anon peak 375 MiB (prefork, 2-frame TIFF), no OOM; `--pool=solo` not needed (rule: anon under 430 MiB)
- [x] Upstash: `?ssl_cert_reqs=required` is needed on the single `REDIS_URL` (documented in design.md section 5)
- [x] Backend on Render (https://ledquill.onrender.com): `/api/v1/health` 200 with database and redis ok; clean_01.pdf, multi_01.pdf, scan_10_medium.tif, register_01.xlsx, scan_09_medium.png all `completed`; approve and delete verified
- [x] Frontend on Vercel (tested at https://ledquill.vercel.app): proxy health 200; upload, approve, delete work; API key found in 0 of 15 client JS files; 4.2 MB upload accepted, 4.8 MB rejected by the platform (413); `NEXT_PUBLIC_MAX_UPLOAD_MB=4`; 413 maps to a "File too large" message (code change, lint and typecheck pass)
- [x] Redis use measured on the live service: the Render service stays awake, with about 33 Redis commands per minute (about 48K per day, about 1.4M per month), above the Upstash 500K monthly allowance
- [x] Demo Redis switched to a Render Key Value instance (in-memory, no command limit, within the demo hosting limits, same region Singapore, internal URL, no `ssl_cert_reqs`, volatile eviction policy). Verified after the switch: `/api/v1/health` 200 with redis ok, and clean_01.pdf `completed` through ledquill.vercel.app. Trade-offs: data is lost whenever the instance restarts (queued jobs lost; the 15-minute stale-job reprocess is the way out; LLM cache and rate counters reset). Upstash stays as a fallback and the `ssl_cert_reqs` finding still applies to it
- [x] External uptime monitor pings `/api/v1/health` every 5 minutes to keep the Render service awake. Render's demo hosting limit is 750 instance hours per workspace per month and an always-on service uses about 744 in a 31-day month, so no other web service may run in this workspace
- [x] Dropzone shows "up to 4 MB per upload (hosted demo)" and an oversized upload shows the "File too large" message in the browser (confirmed from screenshots of the live site)
- ~~[ ] Deployment guide (`docs/deployment.md`)~~ folded into the README (Demo hosting section); no separate file
- [x] Split dev dependencies out of the production image (requirements-dev.txt)
- [ ] Render memory graph: not read (not available on the Render plan in use)
- [x] Supabase bucket empty after test cleanup: verified by hand on 2026-11-24, documents bucket object count 0 after deleting documents from the UI
- [ ] Redis `llm:cache` keys written by Render: pending, not inspected
- [x] Verified by hand on 2026-11-24: Render Key Value in use (`REDIS_URL` is the internal `redis://red-...` URL); a clean_01.pdf upload through ledquill.vercel.app completed on it; uptime monitor active (keyword monitor, GET, every 5 minutes, status Up); no out-of-memory or restart entries in the Render Events list
- [ ] Cold start time on Render: not measured (an uptime monitor now keeps the service awake)
- [ ] Live Gemini failover (see P6) and Celery retry end to end: not confirmed
- [x] **Gate:** live link processes one PDF end to end (Render API and Vercel proxy, clean_01.pdf `completed`)

## P8 — Release documentation

- [ ] README with setup instructions
- [ ] Architecture diagram and database schema in `docs/`
- [ ] AI prompts (`docs/prompts.md`)
- [ ] AI-assisted development disclosure (`docs/ai-disclosure.md`)
- [ ] Tag `v1.0`

## Release deliverables

- [ ] 1. Git repository with source code
- [ ] 2. README and setup instructions
- [ ] 3. Architecture diagram and database schema
- [ ] 4. Working backend API and frontend
- [ ] 5. PDF, image, Excel and CSV processing pipelines
- [ ] 6. Automated tests and test results
- [ ] 7. Evaluation report with measured metrics
- [ ] 8. AI prompts and AI-assistance disclosure
