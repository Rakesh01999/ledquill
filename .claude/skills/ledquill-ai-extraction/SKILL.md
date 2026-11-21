---
name: ledquill-ai-extraction
description: How LedQuill turns documents into trusted invoice data. Use for any work on text extraction, OCR and image preprocessing, spreadsheet parsing, invoice page splitting, regex pre-extraction, LLM providers, prompts, rate limiting and failover, grounding checks, confidence scores, validation rules V-01 to V-09, duplicates, or cross-verification — anything in backend/app/pipeline or backend/app/llm.
---

# LedQuill AI Extraction

The product promise is **trust**: every value shown is printed in the source,
or it is null and flagged. Accuracy you can verify beats coverage you cannot.

## Text extraction

- PDF: PyMuPDF page by page (`page.get_text("text")`); never load all pages'
  images at once. A page with < 50 non-space characters is treated as scanned.
- Scanned page / image: render at 300 DPI -> grayscale -> deskew (minAreaRect
  on text pixels, skip if angle < 0.5 degrees) -> denoise (fastNlMeans or
  median 3) -> adaptive threshold -> Tesseract `--oem 1 --psm 6`, keep mean word
  confidence per page. Try `--psm 4` only if confidence < 60.
- TIFF can be multi-frame: iterate frames as pages.
- Spreadsheets: read every sheet (`sheet_name=None`); detect the header row as
  the first row with >= 3 non-empty text cells; map columns to fields by a
  synonym table first (`inv no`, `invoice #`, `bill no` -> invoice_number), LLM
  only for headers the table cannot map. Each row (or row group by invoice
  number) is one invoice. CSV: detect encoding (utf-8, utf-8-sig, cp1252) and
  delimiter with `csv.Sniffer`.
- Corrupt / encrypted / zero-page files raise a `PermanentError` with a clear
  message; they are not retried.

## Splitting multi-invoice PDFs

A page starts a new invoice when it contains an invoice header pattern
(`invoice` + a number-like token near "no/number/#") and that number differs
from the current invoice's number. Other pages attach to the current invoice.
Repeated headers with the same number = continuation page. Record
`page_numbers` on each invoice.

## Rules before LLM

`pipeline/rules.py` extracts with regex what is reliable: invoice number,
dates (multiple formats), currency symbols/codes, labelled totals
("subtotal", "tax/VAT", "total/amount due"). These become `rule_hints` for the
prompt and a fallback if every LLM fails.

## LLM calls

- Prompt text and JSON schema exactly as `docs/design.md` section 4; constant
  `PROMPT_VERSION` stored on every invoice.
- Provider interface: `extract(text, hints) -> ExtractionResult`; Groq via the
  OpenAI-compatible endpoint, Gemini via its REST API. Model order from
  `LLM_MODELS`.
- Settings: temperature 0, JSON response format; for gpt-oss
  `reasoning_effort="low"`, `include_reasoning=False` (measured saving ~25%).
- Input budget: trim to ~6K tokens (estimate 4 chars per token); drop repeated
  headers/footers first, keep totals area.
- Token bucket per model (TPM and TPD from settings) checked before the call;
  on 429 or bucket empty -> next model; all exhausted -> retry later via Celery.
- Cache key `sha256(text + hints + PROMPT_VERSION)` in Redis (7 days).
- Validate output with the Pydantic model; on invalid JSON retry once with
  "Return valid JSON only", then next model.

## Grounding (the anti-hallucination guard, in code)

For each returned field:
- numbers: normalise (remove separators/currency) and search in normalised
  source text; also accept if printed with different separators.
- names / invoice number: case-insensitive substring, or `rapidfuzz` partial
  ratio >= 90.
- dates: any common printed format of that date appears.
Not found -> value null, confidence 0, `raw_extraction` keeps what the model
said. Rule value and LLM value disagree -> keep grounded one; if both grounded,
prefer LLM and cap confidence at 0.6.

## Validation (requirements.md section 7)

- Tolerance for sums: `abs(a - b) <= max(0.01, 0.005 * b)`.
- Never compute and fill a missing value; validation compares printed numbers.
- Duplicate (V-07): same `supplier_norm` + `invoice_number`, or same sha256.
- Cross-check (V-09): same `invoice_number` (+ supplier) across documents;
  compare total, date, supplier; store issue with `related_invoice_id`.
- Status: any error or >= 2 warnings or a required field < 0.7 confidence ->
  `needs_review`, else `ready`.
- Every issue message states expected vs actual in plain words.
