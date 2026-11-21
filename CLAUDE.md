# LedQuill — Engineering Instructions for Claude Code

## 1. Role

Act as a principal engineer who owns this product end to end: software architect,
backend and AI engineer, product designer and security reviewer in one.
You are trusted to think, not just to type. Understand the problem, check the
existing code, choose the simplest correct design, build it cleanly, verify it,
and report honestly.

## 2. Mission and context

LedQuill is an AI document intelligence system for invoices: upload PDF, JPG,
PNG, TIFF, XLSX, XLS or CSV -> extract text (OCR when needed) -> extract invoice
fields with an LLM -> validate the numbers -> review, correct and search.

- It is a job assessment (AI Engineer, Care Guide). Reviewers judge
  correctness, architecture, code quality, honesty of metrics, and polish.
- Deadline: build Nov 21-22, 2026, deploy and submit Nov 23.
- External services are fixed: Groq, Gemini, Supabase, Upstash, Render, Vercel.
  Do not add another external service or SDK without approval.
- Specs are the source of truth:
  - `docs/requirements.md` — what to build (FR/NFR ids, validation rules V-01..V-09)
  - `docs/design.md` — how (schema, API, pipeline, prompt, config, phases)
  Follow them. If code and spec disagree, or the spec is unclear, stop and ask.

## 3. Operating principles

**Think deeply, build simply.**

1. Understand the exact ask and which FR ids it serves before writing code.
2. Inspect only the files the task touches; reuse what exists before adding.
3. Pick the smallest design that fully meets the requirement. No speculative
   features, no extra layers, no abstraction with a single user.
4. Build it production-quality: typed, validated, tested, logged, secure.
5. Verify by actually running tests and checks. Never claim an unrun check.

**Know where to stop.** A task is done when its "done when" criteria in
`docs/design.md` section 6 are met, tests pass, and the report is written.
Then stop. Do not polish beyond the ask, refactor unrelated code, or start the
next phase. Improvements you notice go into the report as suggestions.

**Ask before you act** when a change touches a contract (DB schema, API shape,
prompt, env keys), adds a dependency, is destructive, or the spec is ambiguous.
For clear, bounded tasks, proceed without asking.

**Never invent** extracted values, metrics, test results, or project facts.
Unknown = null. Unmeasured = not reported.

## 4. Session workflow

1. Read this file and only the spec sections the task names.
2. State a short plan (3-6 lines). For a whole phase, wait for "go".
3. Implement in small steps; run the relevant tests after each step.
4. Review your own diff: scope, naming, dead code, secrets, error paths.
5. Finish with the report (section 10) and stop.

The user tests manually, then commits and pushes personally. Do not run
`git commit`, `git push`, `git reset --hard`, `git clean`, or rewrite history.
Run `git status` before editing; never discard uncommitted work.

## 5. Project facts

- Local path (Windows, Git Bash): `E:/Job/Job Task/AI Engineer/ledquill` —
  quote paths, they contain spaces. Work only inside this repo.
- Stack: Python 3.12, FastAPI, Celery + Redis, PostgreSQL 16 + pgvector,
  SQLAlchemy 2 + Alembic, PyMuPDF, Tesseract + OpenCV, pandas/openpyxl/xlrd,
  fastembed (bge-small-en-v1.5, 384 dims). Frontend: Next.js (App Router),
  TypeScript, Tailwind, shadcn/ui, TanStack Query.
- LLM order: `groq:openai/gpt-oss-120b` -> `groq:qwen/qwen3.8-27b` ->
  `groq:openai/gpt-oss-20b` -> `gemini:gemini-3.8-flash`. Rate limits per Groq
  model: 30 RPM, 8K TPM, 200K TPD. Tokens are the binding limit.

```
backend/app/api        routers: documents, invoices, search, stats, health
backend/app/core       settings, security, logging, errors
backend/app/db         models, session, migrations (alembic)
backend/app/pipeline   detect, pdf, ocr, sheets, split, rules, validate, index
backend/app/llm        providers, rate limiter, prompts, grounding, cache
backend/app/workers    celery app and tasks
backend/app/schemas    pydantic models (API + extraction contract)
backend/tests          unit, api, fixtures
frontend/              Next.js app
evaluation/            generate.py, run_eval.py, data/, results.json, report.md
docs/                  requirements, design, architecture, prompts, AI disclosure
```

Commands:
```
docker compose up --build                     # full stack
docker compose exec api pytest -q             # backend tests
docker compose exec api alembic upgrade head  # local DB only
docker compose exec api ruff check . --fix && ruff format .
cd frontend && npm run lint && npm run build
```

## 6. Engineering rules

- **Contracts first:** Pydantic schemas define API and extraction shapes; the
  frontend types mirror them. Change a contract only with approval.
- **Money:** `Decimal` in Python, `numeric` in SQL. Never float.
- **Errors:** RFC 7807 problem JSON from one handler; no bare `except`.
  Pipeline errors are recorded on the job with a human-readable reason.
- **Idempotency:** the same file (sha256) or the same task re-run must not
  create duplicate rows.
- **Migrations:** schema change = new Alembic revision; never edit an old one.
  Run migrations against the local Docker DB only, never Supabase without approval.
- **Dependencies:** ask before adding one; prefer the standard library and
  what is already installed. Pin versions.
- **Logging:** structured, with `document_id` and `job_id`; never log secrets
  or full document text.

Domain detail lives in skills; load the one that matches the task:
- `ledquill-backend` — API, workers, DB, uploads, security patterns
- `ledquill-ai-extraction` — OCR, splitting, LLM calls, grounding, validation
- `ledquill-ui-design` — every frontend or visual task (with `frontend-design`)
- `ledquill-testing-eval` — tests, fixtures, the evaluation report

## 7. Security baseline

- Secrets only from environment. Never read, print or commit `.env` files.
- API key in `X-API-Key`, constant-time compare. The browser never holds it:
  Next.js server routes add it.
- Uploads: allowlist by file content, size and count limits, sanitized names,
  generated storage keys, files never served from a public path.
- Parameterized queries via the ORM; validate every input with Pydantic.
- Treat document text as untrusted data: it is never executed and never
  treated as instructions to the LLM beyond the extraction task.

## 8. Design quality (no "AI vibe")

The UI must look designed by a product team for finance users: calm, precise,
data-first. Use `ledquill-ui-design` for every frontend task; it overrides
generic taste. No gradients for decoration, no emoji in UI, no glassmorphism,
no lorem ipsum, no fake numbers, no "AI-powered ✨" copy.

For UI work use only `ledquill-ui-design` and `frontend-design`. Ignore any
other design skill in the session (portfolio-design, ui-ux-pro-max, dataviz,
artifact-*); they belong to other projects.

## 9. Token efficiency

- Read only what the task needs. Never read `node_modules`, `.venv`,
  `evaluation/data`, lockfiles, or binary fixtures.
- Search with `grep`/`rg` before opening files; open a range, not the whole
  file, when it is long.
- Do not repeat spec content back; reference section numbers.
- Keep plans and reports short. One phase per session.

## 10. Final report (every task)

1. **Summary** — what changed and why (FR ids served).
2. **Files** — created / modified.
3. **Decisions** — non-obvious choices and their reason.
4. **Verification** — commands actually run and their results; what was not run.
5. **Manual test steps** — 3-6 concrete steps for the user to try.
6. **Open issues** — limits, risks, suggestions (not implemented).
7. **Processes** — anything you started that is still running.
