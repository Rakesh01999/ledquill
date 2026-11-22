# LedQuill — Delivery Checklist

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
- [x] **Gate:** `docker compose up` works, health is green, CI passes (CI green and integration tests per file type pass, confirmed by the owner)

## P1 — Ingestion (Task 1)

- [ ] Storage interface: local and Supabase backends — LocalStorage verified; SupabaseStorage written but untested
- [x] `POST /documents`: multi-file upload, size/count limits, type by content, sha256, 202 response (FR-01, FR-02)
- [x] Digital PDF text extraction per page (FR-03)
- [x] OCR with preprocessing for scans and images, incl. multi-frame TIFF (FR-04)
- [x] XLSX, XLS and CSV parsing, all sheets (FR-05)
- [x] Corrupt and encrypted files fail with a clear reason (FR-06)
- [x] Processing events per stage with timings; progress updates
- [x] Fixtures and unit tests for each file type
- [x] **Gate:** every fixture produces page text; a corrupt file ends `failed` with a reason

## P2 — Extraction and validation (Tasks 2, 3)

- [x] Multi-invoice PDF splitting (FR-07)
- [x] Rules-based pre-extraction
- [x] LLM providers with failover, token buckets, cache (FR-08)
- [x] Versioned prompt and Pydantic output validation
- [x] Grounding check: unfound values become null (FR-09)
- [x] Validation rules V-01 to V-08 (FR-10, FR-11, FR-12)
- [x] Review flag with reasons (FR-13)
- [x] Cross-verification PDF-PDF and PDF-Excel, V-09 (FR-14)
- [x] Tests with mocked LLM; one opt-in live test (live run: Groq call and grounding worked; its final assertion was fixed afterwards and not re-run, see report)
- [x] **Gate:** a sample invoice yields correct fields and the expected issues (total-mismatch case verified by hand by the owner)

## P3 — Labeled dataset (Task 7)

- [x] Generator with fixed seed (`evaluation/generate.py`)
- [x] Clean PDFs, degraded scans, multi-invoice PDF, missing fields, wrong totals, duplicates, Excel register
- [x] Ground truth in `evaluation/data/labels.json`
- [ ] A few real public invoices with hand-made labels
- [x] **Gate:** about 60 labeled files (58 files, 65 invoices, 12 MB; `evaluation/check_dataset.py` passes)

## P4 — API and search (Tasks 4, 5)

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

## P5 — Frontend (Task 6)

- [x] App shell, design tokens, light and dark mode (C1: shell, tokens, proxy, typed client; screens follow)
- [x] Documents: multi-upload with live per-file progress (FR-20) (C2: upload, list, polling, detail with page text and image, reprocess, delete; verified in Edge against the running stack)
- [x] Invoice review: source beside fields, confidence, issues, inline edit, approve (FR-20) (C3: verified in Edge; line items are read-only)
- [x] Review queue (C3: /invoices?sort=severity, count badge, queue Prev/Next)
- [x] Search with filters (C3: hybrid search and keyword filters; mode toggle cut, hybrid only)
- [ ] Dashboard
- [ ] Loading, empty, error states on every view
- [ ] Performance budget met (prd.md §8)
- [ ] Accessibility and responsive checks (375 / 768 / 1280 / 1536 px)
- [ ] **Gate:** full flow works in the browser

## P6 — Tests and evaluation (Task 7)

- [ ] Failure scenario tests (corrupt, encrypted, empty, oversized, wrong type, LLM down, rate-limited, duplicate)
- [ ] Evaluation script through the real API (`evaluation/run_eval.py`)
- [ ] `evaluation/results.json` and `evaluation/report.md` with measured accuracy, timing, success and failure rates
- [ ] Test results saved for submission
- [ ] Reuse stored pages on job retry instead of re-running OCR
- [ ] Document in README: V-07/V-09 flag only the later-processed invoice; same-hash duplicates with no invoice row are not caught
- [ ] `run_eval` uploads files with `depends_on` sequentially and waits for the partner to complete
- [ ] Estimate LLM token use for ~60 files against daily limits before the full run
- [ ] **Gate:** CI green, report contains only measured numbers

## P7 — Deployment

- [ ] Supabase schema migrated
- [ ] Backend on Render (API + worker)
- [ ] Frontend on Vercel
- [ ] Deployment guide (`docs/deployment.md`)
- [ ] Split dev dependencies out of the production image (requirements-dev.txt)
- [ ] **Gate:** live link processes one PDF end to end

## P8 — Submission package

- [ ] README with setup instructions
- [ ] Architecture diagram and database schema in `docs/`
- [ ] AI prompts (`docs/prompts.md`)
- [ ] AI-assisted development disclosure (`docs/ai-disclosure.md`)
- [ ] Walkthrough video recorded and linked
- [ ] Tag `v1.0`

## Assessment deliverables (from the task brief)

- [ ] 1. Git repository with source code
- [ ] 2. README and setup instructions
- [ ] 3. Architecture diagram and database schema
- [ ] 4. Working backend API and frontend
- [ ] 5. PDF, image, Excel and CSV processing pipelines
- [ ] 6. Automated tests and test results
- [ ] 7. Evaluation report with measured metrics
- [ ] 8. Recorded walkthrough
- [ ] 9. AI prompts and AI-assistance disclosure

## Application package

- [ ] Updated CV (education: institution, subject, year, result; experience: company, position, responsibilities, duration)
- [ ] Portfolio link
- [ ] Reference 1: department head or academic supervisor (official email)
- [ ] Reference 2: former HR manager or HR representative (official email)
- [ ] Reply All to the original email, apply@careguidebd.com included
