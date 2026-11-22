"""Self-checks for the generated dataset. No LLM, no network.

    MSYS_NO_PATHCONV=1 docker compose exec -T -e PYTHONPATH=/app api \
        python /evaluation/check_dataset.py

Checks: determinism, label/file parity, clean-PDF text layers and page geometry, label
arithmetic vs expected V-03/V-04/V-05, spreadsheet registers, failure files, and the OCR
coverage of the mild scans (existing OCR pipeline only).
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pymupdf
from rapidfuzz import fuzz

import generate as gen

DATA = gen.DATA
failures: list[str] = []


def check(ok: bool, message: str) -> None:
    print(("PASS  " if ok else "FAIL  ") + message)
    if not ok:
        failures.append(message)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def squash(s: str) -> str:
    return re.sub(r"\s+", "", s).casefold()


# ------------------------------------------------------------------ determinism


def check_determinism() -> list[gen.Record]:
    tmp = Path(tempfile.mkdtemp(prefix="evalgen_"))
    try:
        runs = []
        for k in (1, 2):
            out = tmp / f"run{k}"
            records = gen.build(out)
            gen.write_labels(records, out)
            runs.append((out, records))
        names1 = sorted(p.name for p in runs[0][0].iterdir())
        names2 = sorted(p.name for p in runs[1][0].iterdir())
        check(names1 == names2, f"two runs produce the same {len(names1)} files")
        differing = [
            n
            for n in names1
            if n != "failure_02_encrypted.pdf" and sha(runs[0][0] / n) != sha(runs[1][0] / n)
        ]
        check(not differing, f"byte-identical across runs (all but encrypted): {differing or 'ok'}")
        for path in (
            runs[0][0] / "failure_02_encrypted.pdf",
            runs[1][0] / "failure_02_encrypted.pdf",
        ):
            with pymupdf.open(path) as doc:
                check(doc.needs_pass, f"encrypted file needs a password in {path.parent.name}")
        committed = {n: sha(DATA / n) for n in names1 if (DATA / n).exists()}
        stale = [
            n
            for n in names1
            if n != "failure_02_encrypted.pdf" and committed.get(n) != sha(runs[0][0] / n)
        ]
        check(not stale, f"evaluation/data matches a fresh generation: {stale or 'ok'}")
        return runs[0][1]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------ parity


def check_parity(records: list[gen.Record]) -> dict:
    labels = json.loads((DATA / "labels.json").read_text(encoding="utf-8"))
    files = {p.name for p in DATA.iterdir() if p.is_file() and p.name != "labels.json"}
    check(set(labels) == files, f"labels.json keys == files on disk ({len(files)})")
    check(len(records) == len(labels), "record count equals label count")
    check(all(k == e["file"] for k, e in labels.items()), "each label key equals its file field")
    required = {
        "file", "group", "quality", "upload_order", "depends_on", "expected_status",
        "expected_invoices", "expected_issues", "notes",
    }  # fmt: skip
    check(all(required <= set(e) for e in labels.values()), "every label has all required keys")
    scan_q = {e["quality"] for e in labels.values() if e["group"] == "scan"}
    check(scan_q == {"mild", "medium", "severe"}, f"scan qualities recorded: {sorted(scan_q)}")
    order = sorted(e["upload_order"] for e in labels.values())
    check(order == list(range(1, len(labels) + 1)), "upload_order is 1..N without gaps")
    by_file = {e["file"]: e for e in labels.values()}
    late = all(
        by_file[d]["upload_order"] < e["upload_order"]
        for e in labels.values()
        for d in (e["depends_on"] or [])
    )
    check(late, "every depends_on partner uploads before its dependant")
    return labels


# ------------------------------------------------------------------ label arithmetic


def within(a: Decimal, b: Decimal) -> bool:
    return abs(a - b) <= max(Decimal("0.01"), abs(b) * Decimal("0.005"))


def derived_rules(inv: dict) -> set[str]:
    rules: set[str] = set()
    items = inv["line_items"]
    for it in items:
        if None not in (it["quantity"], it["unit_price"], it["amount"]):
            expected = Decimal(it["quantity"]) * Decimal(it["unit_price"])
            if abs(expected - Decimal(it["amount"])) > Decimal("0.01"):
                rules.add("V-03")
    sub, tax, total = (Decimal(inv[k]) if inv[k] else None for k in ("subtotal", "tax", "total"))
    line_sum = sum((Decimal(i["amount"]) for i in items), Decimal("0"))
    if items and sub is not None and not within(line_sum, sub):
        rules.add("V-04")
    if None not in (sub, tax, total) and not within(sub + tax, total):
        rules.add("V-05")
    return rules


def check_label_arithmetic(labels: dict) -> None:
    bad = []
    for name, entry in labels.items():
        if entry["group"] in ("register", "hostile", "failure", "duplicate"):
            continue
        expected = {r for r in entry["expected_issues"] if r in ("V-03", "V-04", "V-05")}
        for inv in entry["expected_invoices"]:
            if derived_rules(inv) != expected:
                bad.append((name, sorted(derived_rules(inv)), sorted(expected)))
    check(not bad, f"V-03/04/05 re-derived from label numbers match expected_issues: {bad or 'ok'}")
    required = ("invoice_number", "invoice_date", "supplier_name", "total")
    bad = []
    for name, entry in labels.items():
        if entry["group"] in ("register", "failure"):
            continue
        for inv in entry["expected_invoices"]:
            missing = any(inv[k] is None for k in required)
            if missing != ("V-01" in entry["expected_issues"]):
                bad.append(name)
    check(not bad, f"V-01 expected exactly when a required field is null: {bad or 'ok'}")


# ------------------------------------------------------------------ clean PDFs


def check_text_layers(records: list[gen.Record]) -> None:
    pdf_groups = ("clean", "absent", "inconsistent", "multi", "hostile", "duplicate")
    missing, geometry = [], []
    for rec in records:
        if rec.group not in pdf_groups or not rec.file.endswith(".pdf"):
            continue
        with pymupdf.open(DATA / rec.file) as doc:
            text = "\n".join(p.get_text("text") for p in doc)
            flat = squash(text)
            for page in doc:
                words = page.get_text("words")
                rect = page.rect
                for w in words:
                    box = pymupdf.Rect(w[:4])
                    if box.x1 > rect.x1 + 1 or box.y1 > rect.y1 + 1 or box.x0 < -1 or box.y0 < -1:
                        geometry.append(f"{rec.file} p{page.number + 1}: '{w[4]}' off page")
                lines: dict[tuple[int, int], list[pymupdf.Rect]] = {}
                for w in words:
                    lines.setdefault((w[5], w[6]), []).append(pymupdf.Rect(w[:4]))
                rects = [r for rs in lines.values() for r in rs]
                for i, a in enumerate(rects):
                    for b in rects[i + 1 :]:
                        inter = a & b
                        if not inter.is_empty and inter.get_area() > 0.4 * min(
                            a.get_area(), b.get_area()
                        ):
                            geometry.append(f"{rec.file} p{page.number + 1}: overlapping words")
                            break
        for inv_printed, inv_label in zip(rec.printed, rec.invoices, strict=True):
            for field, value in inv_printed.items():
                if field in ("subtotal", "tax", "total"):
                    ok = digits(value) in {digits(t) for t in re.findall(r"[\d.,]+\d", text)}
                else:
                    ok = squash(value) in flat
                if not ok:
                    missing.append(f"{rec.file}:{field}={value}")
            cur = inv_label["currency"]
            if cur and cur not in text and {"USD": "$", "EUR": "€"}.get(cur, "\0") not in text:
                missing.append(f"{rec.file}:currency={cur}")
            for item in inv_label["line_items"]:
                if squash(item["description"]) not in flat:
                    missing.append(f"{rec.file}:item={item['description']}")
    check(not missing, f"text layers contain every label value: {missing[:5] or 'ok'}")
    check(not geometry, f"no off-page or overlapping text: {sorted(set(geometry))[:5] or 'ok'}")


# ------------------------------------------------------------------ registers, failures


def check_registers_and_failures(labels: dict) -> None:
    x = pd.read_excel(DATA / "register_01.xlsx")
    c = pd.read_csv(DATA / "register_02.csv")
    check(len(x) + len(c) == 8, f"registers hold 8 rows in total ({len(x)} + {len(c)})")
    check(
        len(labels["register_01.xlsx"]["expected_invoices"]) == len(x)
        and len(labels["register_02.csv"]["expected_invoices"]) == len(c),
        "register labels have one invoice per row",
    )
    mismatches = sum(
        1
        for f in ("register_01.xlsx", "register_02.csv")
        for inv in labels[f]["expected_invoices"]
        if inv["row_issues"] != ["V-07"]
    )
    check(mismatches == 3, f"3 deliberate register mismatches ({mismatches})")
    from app.core.errors import PermanentError  # noqa: PLC0415
    from app.pipeline.pdf import open_pdf  # noqa: PLC0415

    for name in ("failure_01_corrupt.pdf", "failure_02_encrypted.pdf"):
        try:
            open_pdf(DATA / name, 50).close()
            check(False, f"pipeline rejects {name}")
        except PermanentError as exc:
            check(True, f"pipeline rejects {name}: {exc}")
    dup = labels["dup_03.pdf"]
    check(sha(DATA / "dup_03.pdf") == sha(DATA / dup["depends_on"][0]), "dup_03 is byte-identical")


# ------------------------------------------------------------------ OCR coverage


def check_ocr_mild(records: list[gen.Record]) -> None:
    from app.pipeline import ocr  # noqa: PLC0415 - needs PYTHONPATH=/app

    found = total = 0
    for rec in records:
        if rec.group != "scan" or rec.quality != "mild":
            continue
        img = ocr.open_image(DATA / rec.file, 10, 40_000_000)
        text = "\n".join(ocr.ocr_image(g).text for g in ocr.iter_gray_frames(img, 40_000_000))
        flat = squash(text)
        tokens = {digits(t) for t in re.findall(r"[\d.,]+\d", text)}
        hit = n = 0
        for field, value in rec.printed[0].items():
            n += 1
            if field in ("subtotal", "tax", "total"):
                ok = digits(value) in tokens
            elif field in ("supplier_name", "customer_name"):
                ok = fuzz.partial_ratio(squash(value), flat) >= 90
            else:
                ok = squash(value) in flat
            hit += ok
            if not ok:
                print(f"      miss {rec.file} {field}={value!r}")
        print(f"      {rec.file}: {hit}/{n} label values found in OCR text")
        found += hit
        total += n
    share = found / total if total else 0.0
    print(f"INFO  mild scans: {found}/{total} label values in OCR text = {share:.1%}")
    check(total > 0, "OCR coverage computed for the mild scans (informational, no threshold)")


def main() -> int:
    records = check_determinism()
    labels = check_parity(records)
    check_label_arithmetic(labels)
    check_text_layers(records)
    check_registers_and_failures(labels)
    check_ocr_mild(records)
    size = sum(p.stat().st_size for p in DATA.rglob("*") if p.is_file())
    print(f"INFO  dataset size {size / 1e6:.2f} MB")
    print(f"\n{len(failures)} failing check(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    raise SystemExit(main())
