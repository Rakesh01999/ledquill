# LedQuill evaluation report

Run: 2026-11-22T15:38:37+00:00  |  files run: 58 of 58  |  subset: no

All numbers are measured by `evaluation/run_eval.py` against `labels.json` through the real API. `n/a` means the metric had no data. Synthetic and real files are reported separately and never blended.

## Synthetic files

- Files: 58; document status as expected: 100.0%; invoice count as expected: 100.0%
- needs_review accuracy (matched invoices): 84.4%
- Validation rule sets exactly right per file: 77.6%

| Field | Precision | Recall | TP | FP | FN | Hallucinated |
|---|---|---|---|---|---|---|
| invoice_number | 98.2% | 88.9% | 56 | 1 | 7 | 0 |
| invoice_date | 100.0% | 90.5% | 57 | 0 | 6 | 0 |
| supplier_name | 98.3% | 90.5% | 57 | 1 | 6 | 0 |
| customer_name | 98.2% | 88.9% | 56 | 1 | 7 | 0 |
| currency | 98.2% | 87.3% | 55 | 1 | 8 | 0 |
| subtotal | 100.0% | 87.5% | 56 | 0 | 8 | 0 |
| tax | 98.2% | 87.3% | 55 | 1 | 8 | 0 |
| total | 98.2% | 84.4% | 54 | 1 | 10 | 0 |
| line items (by amount) | 95.4% | 89.0% | 251 | 12 | 31 | - |

| Rule | Precision | Recall | TP | FP | FN |
|---|---|---|---|---|---|
| V-01 | 23.1% | 100.0% | 3 | 10 | 0 |
| V-02 | 0.0% | n/a | 0 | 1 | 0 |
| V-03 | 40.0% | 100.0% | 2 | 3 | 0 |
| V-04 | 100.0% | 100.0% | 3 | 0 | 0 |
| V-05 | 100.0% | 100.0% | 2 | 0 | 0 |
| V-07 | 100.0% | 100.0% | 5 | 0 | 0 |
| V-08 | 50.0% | 100.0% | 1 | 1 | 0 |
| V-09 | 100.0% | 50.0% | 1 | 0 | 1 |

## Real files

No real files were run.

## Timing

| Stage | n | p50 ms | p95 ms |
|---|---|---|---|
| detect | 58 | 0 | 2 |
| extract | 56 | 11 | 1065 |
| split | 56 | 2 | 4 |
| fields | 56 | 1411 | 2546 |
| validate | 56 | 7 | 18 |
| index | 56 | 21 | 36 |

End to end (upload to terminal status): p50 2.1 s, p95 4.1 s over 58 files.

## LLM tokens (actual, as reported by the providers)

Prompt 46070, completion 24042, total 70112 across 51 files that called a model.

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
| clean_13.pdf | clean | completed/completed | 1/1 | 2.1 |
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
| register_01.xlsx | register | completed/completed | 5/5 | 2.1 |
| register_02.csv | register | completed/completed | 3/3 | 2.0 |
