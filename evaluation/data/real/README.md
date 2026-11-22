# Real sample invoices

This folder is reserved for 3-5 real, publicly available sample invoices
(PDF or image). Add them here together with hand-written labels.

Rules:

- Source must be public and freely usable (for example a vendor's published sample
  invoice). Record the source URL in the label's `notes`.
- No personal data, real bank details or real tax ids that were not already public in
  the sample itself.
- Labels use the same shape as `../labels.json` (see `evaluation/generate.py`,
  `Record.label`), written by hand in a separate file: `labels_real.json`.
  Absent fields are `null`; money is a decimal string.

Reporting: `evaluation/report.md` keeps results for these files and for the synthetic
files in `../` in separate tables. Synthetic accuracy is never blended with real accuracy.

`generate.py` never touches this folder.
