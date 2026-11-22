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

- [ ] Repository layout as in `CLAUDE.md`
- [ ] Pydantic settings from environment, `.env.example`
- [ ] FastAPI app factory, `/api/v1/health` (DB + Redis)
- [ ] Celery app with ping task
- [ ] SQLAlchemy models and Alembic migration for the full schema
- [ ] `docker-compose.yml`: db (pgvector), redis, api, worker
- [ ] Dockerfile with Tesseract
- [ ] Ruff and pytest configuration
- [ ] GitHub Actions CI (ruff + pytest with Postgres)
- [ ] **Gate:** `docker compose up` works, health is green, CI passes

## P1 — Ingestion (Task 1)

- [ ] Storage interface: local and Supabase backends
- [ ] `POST /documents`: multi-file upload, size/count limits, type by content, sha256, 202 response (FR-01, FR-02)
- [ ] Digital PDF text extraction per page (FR-03)
- [ ] OCR with preprocessing for scans and images, incl. multi-frame TIFF (FR-04)
- [ ] XLSX, XLS and CSV parsing, all sheets (FR-05)
- [ ] Corrupt and encrypted files fail with a clear reason (FR-06)
- [ ] Processing events per stage with timings; progress updates
- [ ] Fixtures and unit tests for each file type
- [ ] **Gate:** every fixture produces page text; a corrupt file ends `failed` with a reason

## P2 — Extraction and validation (Tasks 2, 3)

- [ ] Multi-invoice PDF splitting (FR-07)
- [ ] Rules-based pre-extraction
- [ ] LLM providers with failover, token buckets, cache (FR-08)
- [ ] Versioned prompt and Pydantic output validation
- [ ] Grounding check: unfound values become null (FR-09)
- [ ] Validation rules V-01 to V-08 (FR-10, FR-11, FR-12)
- [ ] Review flag with reasons (FR-13)
- [ ] Cross-verification PDF-PDF and PDF-Excel, V-09 (FR-14)
- [ ] Tests with mocked LLM; one opt-in live test
- [ ] **Gate:** a sample invoice yields correct fields and the expected issues

## P3 — Labeled dataset (Task 7)

- [ ] Generator with fixed seed (`evaluation/generate.py`)
- [ ] Clean PDFs, degraded scans, multi-invoice PDF, missing fields, wrong totals, duplicates, Excel register
- [ ] Ground truth in `evaluation/data/labels.json`
- [ ] A few real public invoices with hand-made labels
- [ ] **Gate:** about 60 labeled files

## P4 — API and search (Tasks 4, 5)

- [ ] Document list, detail, events; job status (FR-15)
- [ ] Invoice list with keyword filters (FR-18)
- [ ] Invoice detail; PATCH corrections with audit trail and re-validation (FR-15, FR-21)
- [ ] Approve; reprocess failed jobs (FR-15)
- [ ] Embeddings at index stage; semantic and hybrid search (FR-19)
- [ ] `/stats`; rate limiting; RFC 7807 errors
- [ ] API tests incl. 401, 404, 413, 415, 422
- [ ] **Gate:** every endpoint documented in `/docs`, API tests pass

## P5 — Frontend (Task 6)

- [ ] App shell, design tokens, light and dark mode
- [ ] Documents: multi-upload with live per-file progress (FR-20)
- [ ] Invoice review: source beside fields, confidence, issues, inline edit, approve (FR-20)
- [ ] Review queue
- [ ] Search with filters and mode toggle
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
- [ ] **Gate:** CI green, report contains only measured numbers

## P7 — Deployment

- [ ] Supabase schema migrated
- [ ] Backend on Render (API + worker)
- [ ] Frontend on Vercel
- [ ] Deployment guide (`docs/deployment.md`)
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
