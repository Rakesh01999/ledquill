---
name: ledquill-testing-eval
description: Testing and evaluation standards for LedQuill. Use whenever writing or fixing tests, creating fixtures, generating the labeled dataset, running the evaluation, computing accuracy or timing metrics, writing evaluation/report.md, or setting up CI — and before declaring any phase done.
---

# LedQuill Testing and Evaluation

## Test layout

```
backend/tests/unit/        pure functions: detect, pdf, ocr, sheets, split, rules,
                           grounding, validate, rate limiter
backend/tests/api/         endpoints via httpx AsyncClient against a test DB
backend/tests/integration/ one end-to-end run per file type with mocked LLM
backend/tests/fixtures/    tiny files (< 200 KB each) committed to git
```

- pytest + pytest-asyncio; a session-scoped Postgres (the CI service or local
  compose `db`) with a separate `ledquill_test` database; tables truncated
  between tests.
- LLM is always mocked in normal tests (`FakeProvider` returning fixed JSON,
  or raising 429 / timeout). Live calls only in tests marked
  `@pytest.mark.live`, skipped unless `RUN_LIVE=1`.
- Celery runs eagerly in tests (`task_always_eager=True`).

## What must be covered

| Area | Must include |
| --- | --- |
| Document processing | digital PDF, multi-page, multi-invoice split |
| OCR | scanned PNG/JPG/TIFF, rotated and noisy image, low-confidence path |
| Spreadsheets | xlsx with 2 sheets, xls, csv with non-utf8 encoding, messy headers |
| AI extraction | valid JSON, invalid JSON retry, ungrounded value nulled, failover on 429 |
| Validation | each rule V-01..V-09 pass and fail, tolerance edge, duplicate, cross-check |
| API | each endpoint happy path + 401, 404, 413, 415, 422 |
| Failure scenarios | corrupt PDF, encrypted PDF, empty file, all models rate-limited, reprocess after failure |

Name tests by behaviour: `test_total_mismatch_flags_v05`, not `test_validate_3`.

## Labeled dataset (`evaluation/generate.py`)

- Fixed seed; ~60 files; ground truth in `evaluation/data/labels.json` keyed by
  file name, using the same field names as the extraction schema.
- Mix: clean digital PDFs, scanned images (rotation <= 3 degrees, blur, noise,
  low contrast, JPEG artifacts), one multi-invoice PDF, missing fields, wrong
  totals, duplicates, an xlsx register with deliberate mismatches.
- Add a few real public sample invoices with hand-written labels, and report
  synthetic and real results separately so accuracy is not overstated.

## Metrics (`evaluation/run_eval.py`)

- Runs through the real API (upload, poll, fetch) — measures the system, not a
  function.
- Field accuracy per field: exact for invoice_number and date, numeric within
  0.01, names by normalised fuzzy ratio >= 90; null expected and null returned
  counts as correct; a value returned where null expected counts as wrong
  (hallucination).
- Line items: matched by amount; report precision and recall.
- Document success rate = completed / total; failure rate = failed / total.
- Time: p50 and p95 per stage from `processing_events`, plus end-to-end.
- Also report: hallucination count, needs_review rate, LLM model share,
  tokens used.
- Output `evaluation/results.json` (raw) and `evaluation/report.md` (tables +
  short honest discussion of where it fails and why). Include date, commit
  hash, prompt version and model names.

## Honesty rules

Only numbers produced by an actual run go in the report. If a run was partial
(rate limits), say so and report on what completed. Never round up, never
estimate a missing metric.

## Before declaring done

`ruff check .` clean, `pytest -q` green, frontend `npm run lint && npm run build`
green when frontend changed. Paste the actual summary lines in the report.
