# LedQuill — Product Requirements Document

| | |
| --- | --- |
| Product | LedQuill: read, extract, verify invoices |
| Version | 1.0 |
| Status | Approved for build |
| Related | [requirements.md](requirements.md) (FR/NFR, validation rules) · [design.md](design.md) (API, schema) · [CHECKLIST.md](CHECKLIST.md) |

This PRD describes the product from the user's side: who uses it, what they do, and how every screen behaves. Functional and technical detail is not repeated here; it is referenced by id.

## 1. Product summary

Finance teams receive invoices as PDFs, scans, photos and spreadsheets. Today people retype them, check the math by hand and compare documents against each other. LedQuill reads every file, extracts the invoice fields, checks the numbers and shows a reviewer only what needs a human decision.

**Product principle:** *trust over automation.* Every value shown is printed in the source document or is marked as not found. The product never fills a gap with a guess.

## 2. Users

| Persona | Goal | Main pain today | Primary screens |
| --- | --- | --- | --- |
| Accounts officer | Get documents into the system quickly | Retyping, waiting, losing track of files | Documents |
| Finance reviewer | Approve correct invoices, fix wrong ones fast | Finding which invoices are wrong and why | Review queue, Invoice review |
| Finance lead | Know the state of the pipeline at a glance | No visibility of volumes, errors, delays | Dashboard |
| Integrator (developer) | Push documents and read results from other systems | No API | REST API (`/docs`) |

## 3. User stories

| ID | As a… | I want to… | So that… | Acceptance criteria | Refs |
| --- | --- | --- | --- | --- | --- |
| US-01 | Accounts officer | drop many files of mixed types at once | I do not upload one by one | 20 files in one drop; unsupported or oversized files are rejected individually with a reason; the rest proceed | FR-01, FR-02 |
| US-02 | Accounts officer | see live progress for each file | I know what is happening without refreshing | Per-file stage and progress update automatically within 2 s; finished files show a result summary | FR-15, FR-16 |
| US-03 | Accounts officer | see why a file failed and retry it | a bad file does not block my day | Failed files show a plain-language reason and a Reprocess action | FR-06, FR-15 |
| US-04 | Finance reviewer | open a queue of invoices that need review, worst first | I spend time only where it is needed | Queue sorted by severity (errors, then warnings, then low confidence); count shown in navigation | FR-13 |
| US-05 | Finance reviewer | see the source beside the extracted fields | I can verify a value without opening another file | Split view; selecting a field highlights its page | FR-08, FR-20 |
| US-06 | Finance reviewer | understand each issue in numbers | I can fix it without recalculating | Each issue states expected vs actual and links to its field | FR-10, FR-11 |
| US-07 | Finance reviewer | correct a field inline and see the checks re-run | the record becomes correct in one step | Save updates the value, logs the correction and refreshes issues within 1 s | FR-15, FR-21 |
| US-08 | Finance reviewer | approve an invoice with one action or keystroke | clean invoices leave my queue fast | Approve available on ready invoices; keyboard shortcut; next invoice opens automatically | FR-15 |
| US-09 | Finance reviewer | see duplicates and cross-document mismatches | I avoid paying twice or paying the wrong amount | Duplicate and mismatch issues link to the related invoice | FR-12, FR-14 |
| US-10 | Any user | find an invoice by number, supplier, amount, date or meaning | I do not browse page after page | Filters plus free-text search; hybrid mode matches exact numbers and descriptions like "office furniture" | FR-18, FR-19 |
| US-11 | Finance lead | see volumes, success rate, review backlog and processing time | I can spot problems early | Dashboard figures from live data; no placeholder numbers | NFR-06 |
| US-12 | Integrator | upload and read results through a documented API | other systems can use LedQuill | OpenAPI docs at `/docs`; API key auth | FR-15 |

## 4. Core flows

**Flow A — Upload to approval (happy path)**
1. Officer drops files on Documents → each row appears instantly as *Queued*.
2. Rows move through stages (*Reading*, *OCR page 3 of 12*, *Extracting*, *Checking*) → *Completed*, with the number of invoices found.
3. Invoices that pass every rule are *Ready*; the rest go to the Review queue.
4. Reviewer opens the queue → first invoice opens in Invoice review.
5. Reviewer fixes a field (checks re-run) or approves → the next invoice opens.

**Flow B — Failure and recovery**
1. A corrupt file shows *Failed* with the reason ("The PDF is damaged and cannot be opened").
2. The officer replaces it or chooses Reprocess for a transient failure.

**Flow C — Find and verify**
1. User searches "INV-1042" or "laptops from Acme in October".
2. Results show supplier, date, total and status; filters narrow them.
3. Opening a result goes to Invoice review.

## 5. Information architecture

| Navigation item | Route | Purpose |
| --- | --- | --- |
| Documents | `/documents` | Upload and track files |
| — document detail | `/documents/[id]` | Pages, invoices found, processing history |
| Review queue | `/review` | Invoices needing a decision (badge with count) |
| — invoice review | `/invoices/[id]` | Verify, correct, approve |
| Search | `/search` | Filters and hybrid search |
| Dashboard | `/dashboard` | Pipeline health and volumes |

App shell: left sidebar (collapses to icons below 1024 px, drawer below 768 px), top bar with page title and a global search field (`/` to focus).

## 6. Screen specifications

### 6.1 Documents
- **Upload zone** at the top: drag and drop or browse; shows accepted types and limits. Rejected files explained inline, not as a blocking dialog.
- **Documents table:** file name and type icon, status chip, stage text with progress bar, invoices found, issues count, uploaded time. Sortable; filter by status and type.
- **Live updates:** rows refresh every 2 s while any row is processing; polling stops when none are.
- **Row actions:** open, reprocess (failed or completed), download original.
- **States:** empty ("No documents yet. Drop files to start."), loading skeleton rows, error with retry.

### 6.2 Invoice review (core screen)
- **Header:** invoice number, supplier, status chip, Previous / Next in queue, Approve (primary).
- **Issues banner** (only if issues exist): each issue in plain numbers; clicking focuses the field.
- **Split view:** left = source (page image for scans, text for digital PDFs, row view for spreadsheets) with page switcher; right = fields form grouped as *Parties* (supplier, customer), *Invoice* (number, date, currency), *Amounts* (subtotal, tax, total).
- **Confidence:** ≥ 0.9 no marker; 0.7–0.9 amber dot; < 0.7 amber field background with "Low confidence". Missing values show "—" and "Not found in document".
- **Line items table** below the form: description, quantity, unit price, amount; computed sum shown against printed subtotal.
- **Editing:** click a field to edit; Enter saves, Esc cancels; edited fields show an "Edited" marker; corrections history in a side panel.
- **Mobile:** tabs Fields / Source / Issues.

### 6.3 Review queue
- Table of invoices needing review, sorted errors → warnings → low confidence, then oldest first.
- Columns: invoice number, supplier, total, top issue, age.
- Opening an item enters Invoice review in queue mode (Next goes to the next queue item).
- Empty state: "Nothing needs review." with link to Documents.

### 6.4 Search
- Search field with mode toggle: Hybrid (default), Keyword, Semantic.
- Filters: supplier, date range, amount range, currency, status.
- Results table with highlighted matches and relevance order; URL keeps query and filters (shareable).

### 6.5 Dashboard
- Figures: documents processed, success rate, failure rate, invoices awaiting review, average processing time per stage.
- One trend chart (documents per day) and one breakdown (issues by rule).
- Every figure comes from `/stats`; nothing hard-coded.

## 7. Interaction design

| Interaction | Behaviour |
| --- | --- |
| Keyboard | `/` focus search · `J` / `K` next / previous invoice · `E` edit focused field · `A` approve · `Esc` cancel edit |
| Optimistic updates | Approve and field edits update the UI immediately; roll back with a message if the server rejects |
| Feedback | Toasts for completed actions (bottom right, 4 s, not for errors that need action) |
| Motion | 150–200 ms transitions only to show state change; respects `prefers-reduced-motion` |
| Prefetch | Hovering a row prefetches its detail; queue mode prefetches the next invoice |

## 8. Performance budget

Targets follow Google's Core Web Vitals "good" thresholds, measured with Lighthouse on the deployed build.

| Metric | Target |
| --- | --- |
| Largest Contentful Paint (LCP) | ≤ 2.5 s |
| Interaction to Next Paint (INP) | ≤ 200 ms |
| Cumulative Layout Shift (CLS) | ≤ 0.1 |
| Lighthouse performance score | ≥ 90 |
| Initial JavaScript per route | ≤ 200 KB gzipped |

How: Next.js server components by default and client components only where interactive; `next/font` for fonts; skeletons sized to final layout (no shift); TanStack Query caching, prefetching and polling only while work is in progress; virtualised rows for tables over 100 items; no heavy UI libraries beyond shadcn/ui and lucide icons.

## 9. Accessibility and responsiveness

- WCAG 2.1 AA contrast; visible focus; full keyboard operation; semantic tables and labelled inputs.
- Status always shown as text plus colour.
- Layouts checked at 375, 768, 1280 and 1536 px; light and dark themes.

## 10. Success metrics

Targets for the product; actual values are reported only from measurement in `evaluation/report.md`.

| Metric | Target | Source |
| --- | --- | --- |
| Invented values (field returned where none is printed) | 0 | Evaluation |
| Field-level extraction accuracy | Measured and reported per field | Evaluation |
| Document success rate | Measured and reported | Evaluation |
| Median time from upload to result | Measured and reported per stage | Processing events |
| Clicks to approve a clean invoice from the queue | 1 | UI |
| Lighthouse performance score | ≥ 90 | Lighthouse |

## 11. Out of scope for v1

User accounts and roles, ERP export, non-invoice document types, handwriting, languages other than English, real-time collaboration. Listed as future work in the README.

## 12. Open questions

- Should approval lock an invoice against further edits? v1: edits allowed, approval resets to *Ready* if a value changes.
- Should reviewers see the raw LLM output? v1: available in a collapsed "Extraction details" panel for transparency.
