# LedQuill evaluation report

Run: 2026-11-22T15:38:37+00:00  |  files run: 58 of 58  |  subset: no

All numbers are measured by `evaluation/run_eval.py` against `labels.json` through the real API. `n/a` means the metric had no data. Synthetic and real files are reported separately and never blended.

Label policy: scan_11 to scan_15 (severe scans) are expected to need review, as a rule that does not depend on the system's output. Their field labels still describe the printed invoice, so unreadable values count as misses, not as passes.

Rescored with the current scorer at 2026-11-22T16:31:41+00:00; files run again afterwards: clean_13.pdf, register_01.xlsx.

## Synthetic files

- Files: 58; document status as expected: 100.0%; invoice count as expected: 100.0%
- needs_review accuracy (matched invoices): 93.8%
- Validation rule sets exactly right per file: 81.0%
- Review routing (does flagging follow real errors?): 94.5%
  - files with any extraction error flagged for review: 9 of 12; silently ready: scan_08_medium.jpg, scan_09_medium.png, scan_10_medium.tif
  - fully correct files flagged although the label expects no review: 0 of 43

| Field | Precision | Recall | TP | FP | FN | Hallucinated |
|---|---|---|---|---|---|---|
| invoice_number | 98.2% | 88.9% | 56 | 1 | 7 | 0 |
| invoice_date | 100.0% | 90.5% | 57 | 0 | 6 | 0 |
| supplier_name | 98.3% | 90.5% | 57 | 1 | 6 | 0 |
| customer_name | 98.2% | 88.9% | 56 | 1 | 7 | 0 |
| currency | 98.2% | 87.3% | 55 | 1 | 8 | 0 |
| subtotal | 100.0% | 89.1% | 57 | 0 | 7 | 0 |
| tax | 98.2% | 87.3% | 55 | 1 | 8 | 0 |
| total | 98.2% | 85.9% | 55 | 1 | 9 | 0 |
| line items (by amount) | 99.2% | 90.1% | 254 | 2 | 28 | - |

| Rule | Precision | Recall | TP | FP | FN |
|---|---|---|---|---|---|
| V-01 | 25.0% | 100.0% | 3 | 9 | 0 |
| V-02 | 0.0% | n/a | 0 | 1 | 0 |
| V-03 | 40.0% | 100.0% | 2 | 3 | 0 |
| V-04 | 100.0% | 100.0% | 3 | 0 | 0 |
| V-05 | 100.0% | 100.0% | 2 | 0 | 0 |
| V-07 | 100.0% | 100.0% | 5 | 0 | 0 |
| V-08 | 50.0% | 100.0% | 1 | 1 | 0 |
| V-09 | 100.0% | 100.0% | 2 | 0 | 0 |

## Real files

No real files were run.

## Timing

| Stage | n | p50 ms | p95 ms |
|---|---|---|---|
| detect | 58 | 0 | 3 |
| extract | 56 | 11 | 1060 |
| split | 56 | 2 | 5 |
| fields | 56 | 1377 | 2546 |
| validate | 56 | 7 | 22 |
| index | 56 | 22 | 60 |

End to end (upload to terminal status): p50 2.1 s, p95 4.1 s over 58 files.

## LLM tokens (actual, as reported by the providers)

Prompt 45132, completion 23530, total 68662 across 50 files that called a model.

## Per file

| File | Group | Status (expected/actual) | Invoices (exp/act) | Seconds |
|---|---|---|---|---|
| clean_01.pdf | clean | completed/completed | 1/1 | 2.1 |
| clean_02.pdf | clean | completed/completed | 1/1 | 2.0 |
| clean_03.pdf | clean | completed/completed | 1/1 | 2.1 |
| clean_04.pdf | clean | completed/completed | 1/1 | 2.0 |
| clean_05.pdf | clean | completed/completed | 1/1 | 2.1 |
| clean_06.pdf | clean | completed/completed | 1/1 | 2.0 |
| clean_07.pdf | clean | completed/completed | 1/1 | 2.0 |
| clean_08.pdf | clean | completed/completed | 1/1 | 2.0 |
| clean_09.pdf | clean | completed/completed | 1/1 | 2.1 |
| clean_10.pdf | clean | completed/completed | 1/1 | 2.0 |
| clean_11.pdf | clean | completed/completed | 1/1 | 2.0 |
| clean_12.pdf | clean | completed/completed | 1/1 | 4.0 |
| clean_13.pdf | clean | completed/completed | 1/1 | 4.1 |
| clean_14.pdf | clean | completed/completed | 1/1 | 2.0 |
| clean_15.pdf | clean | completed/completed | 1/1 | 2.1 |
| clean_16.pdf | clean | completed/completed | 1/1 | 2.1 |
| clean_17.pdf | clean | completed/completed | 1/1 | 2.0 |
| clean_18.pdf | clean | completed/completed | 1/1 | 2.1 |
| clean_19.pdf | clean | completed/completed | 1/1 | 2.1 |
| clean_20.pdf | clean | completed/completed | 1/1 | 2.0 |
| scan_01_mild.png | scan | completed/completed | 1/1 | 4.1 |
| scan_02_mild.png | scan | completed/completed | 1/1 | 2.1 |
| scan_03_mild.jpg | scan | completed/completed | 1/1 | 2.1 |
| scan_04_mild.jpg | scan | completed/completed | 1/1 | 2.1 |
| scan_05_mild.tif | scan | completed/completed | 1/1 | 4.1 |
| scan_06_medium.png | scan | completed/completed | 1/1 | 4.1 |
| scan_07_medium.jpg | scan | completed/completed | 1/1 | 4.1 |
| scan_08_medium.jpg | scan | completed/completed | 1/1 | 4.1 |
| scan_09_medium.png | scan | completed/completed | 1/1 | 4.1 |
| scan_10_medium.tif | scan | completed/completed | 1/1 | 4.1 |
| scan_11_severe.jpg | scan | completed/completed | 1/1 | 2.1 |
| scan_12_severe.jpg | scan | completed/completed | 1/1 | 4.1 |
| scan_13_severe.png | scan | completed/completed | 1/1 | 4.1 |
| scan_14_severe.png | scan | completed/completed | 1/1 | 2.1 |
| scan_15_severe.tif | scan | completed/completed | 1/1 | 2.1 |
| multi_01.pdf | multi | completed/completed | 4/4 | 6.1 |
| absent_01_supplier.pdf | absent | completed/completed | 1/1 | 2.1 |
| absent_02_date.pdf | absent | completed/completed | 1/1 | 2.0 |
| absent_03_customer.pdf | absent | completed/completed | 1/1 | 2.1 |
| absent_04_tax.pdf | absent | completed/completed | 1/1 | 2.0 |
| absent_05_currency.pdf | absent | completed/completed | 1/1 | 2.1 |
| absent_06_number.pdf | absent | completed/completed | 1/1 | 2.1 |
| inconsistent_01_subtotal.pdf | inconsistent | completed/completed | 1/1 | 2.0 |
| inconsistent_02_subtotal.pdf | inconsistent | completed/completed | 1/1 | 2.0 |
| inconsistent_03_total.pdf | inconsistent | completed/completed | 1/1 | 2.1 |
| inconsistent_04_total.pdf | inconsistent | completed/completed | 1/1 | 2.0 |
| inconsistent_05_line.pdf | inconsistent | completed/completed | 1/1 | 2.0 |
| inconsistent_06_line.pdf | inconsistent | completed/completed | 1/1 | 2.0 |
| hostile_01_injection.pdf | hostile | completed/completed | 1/1 | 2.1 |
| hostile_02_subtle.pdf | hostile | completed/completed | 1/1 | 4.1 |
| hostile_03_blank_template.pdf | hostile | completed/completed | 0/0 | 2.0 |
| failure_01_corrupt.pdf | failure | failed/failed | 0/0 | 2.1 |
| failure_02_encrypted.pdf | failure | failed/failed | 0/0 | 2.0 |
| dup_01.pdf | duplicate | completed/completed | 1/1 | 2.0 |
| dup_02.pdf | duplicate | completed/completed | 1/1 | 2.1 |
| dup_03.pdf | duplicate | completed/completed | 1/1 | 2.0 |
| register_01.xlsx | register | completed/completed | 5/5 | 2.0 |
| register_02.csv | register | completed/completed | 3/3 | 2.0 |
