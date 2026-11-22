"""Run the labeled dataset through the real API and score the results (FR-17, NFR-06, P6).

Run inside the api container (./evaluation is mounted at /evaluation, the key is already in
its environment and is never printed):

    docker compose exec -T api python /evaluation/run_eval.py --tag smoke --limit 3

Options:
    --only GROUPS    comma list of label groups (clean,scan,...) or exact file names
    --limit N        keep the first N selected files (by upload_order), then add partners
    --resume         skip files that already have a finished result in the output file
    --tag NAME       write results.NAME.json / report.NAME.md (default: results.json / report.md)
    --max-tokens N   stop starting new files once N actual LLM tokens were spent (default 150000)

Pacing: files are uploaded one at a time. A file whose label says `depends_on` waits until its
partners finished. Before each upload the script keeps the last 60 s of *actual* LLM tokens
under 75 % of the 8K TPM limit of one model (the chain has more models, so this is
conservative). HTTP 429 problem JSON is honoured through Retry-After, else exponential backoff.

Everything in the report is measured. A metric with no data is written as "n/a", never as 0.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict, deque
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
API = "/api/v1"
FIELDS = ("invoice_number", "invoice_date", "supplier_name", "customer_name", "currency",
          "subtotal", "tax", "total")  # fmt: skip
MONEY = {"subtotal", "tax", "total"}
NAMES = {"supplier_name", "customer_name"}
STAGES = ("detect", "extract", "split", "fields", "validate", "index")
TPM_LIMIT, TPM_SHARE = 8000, 0.75
EST_TOKENS_PER_FILE = 2500  # only used to decide whether to wait; actual tokens are recorded
FUZZY_MIN = 90
TERMINAL = {"completed", "failed"}
LEGAL_SUFFIX = re.compile(r"\b(inc|llc|ltd|limited|gmbh|co|corp|corporation|plc|sa|bv|ag)\b")


# ---------------------------------------------------------------- comparison (pure)


def _dec(value) -> Decimal | None:
    try:
        return None if value is None else Decimal(str(value))
    except InvalidOperation:
        return None


def norm_name(value: str) -> str:
    text = re.sub(r"[^a-z0-9 ]+", " ", str(value).casefold())
    return " ".join(LEGAL_SUFFIX.sub(" ", text).split())


def values_match(field: str, expected, actual) -> bool:
    """Exact for ids, dates and currency; +/-0.01 for money; normalised fuzzy for names."""
    if expected is None or actual is None:
        return expected is None and actual is None
    if field in MONEY:
        a, b = _dec(expected), _dec(actual)
        return a is not None and b is not None and abs(a - b) <= Decimal("0.01")
    if field in NAMES:
        from rapidfuzz import fuzz  # noqa: PLC0415 - only the scorer needs it

        return fuzz.ratio(norm_name(expected), norm_name(actual)) >= FUZZY_MIN
    return str(expected).strip() == str(actual).strip()


def match_invoices(expected: list[dict], actual: list[dict]) -> list[tuple[int, int | None]]:
    """Pair each expected invoice with an actual one: by invoice number first, then in order."""
    taken: set[int] = set()
    pairs: dict[int, int | None] = {}
    for i, exp in enumerate(expected):
        number = exp.get("invoice_number")
        for j, act in enumerate(actual):
            if j not in taken and number and act.get("invoice_number") == number:
                pairs[i] = j
                taken.add(j)
                break
    free = (j for j in range(len(actual)) if j not in taken)
    for i in range(len(expected)):
        if i not in pairs:
            pairs[i] = next(free, None)
            if pairs[i] is not None:
                taken.add(pairs[i])
    return sorted(pairs.items())


def line_item_counts(expected: list[dict], actual: list[dict]) -> tuple[int, int, int]:
    """(tp, fp, fn) matching line items by amount within 0.01."""
    left = [_dec(x.get("amount")) for x in actual]
    tp = 0
    for item in expected:
        want = _dec(item.get("amount"))
        hit = next((k for k, v in enumerate(left) if v is not None and want is not None
                    and abs(v - want) <= Decimal("0.01")), None)  # fmt: skip
        if hit is not None:
            left.pop(hit)
            tp += 1
    # an actual item without an amount can never match: it is a miss (FN) but not an extra (FP)
    return tp, sum(v is not None for v in left), len(expected) - tp


def score_file(
    label: dict, actual: list[dict], doc_status: str, issues_seen: set[str], name: str = ""
) -> dict:
    """Per-file counts. `fields[f]` = {tp, fp, fn, halluc}; everything is summed later."""
    expected = label["expected_invoices"]
    fields = {f: Counter() for f in FIELDS}
    items, review = Counter(), Counter()
    pairs = match_invoices(expected, actual)
    matched = {j for _, j in pairs if j is not None}
    for i, j in pairs:
        exp, act = expected[i], (actual[j] if j is not None else {})
        for f in FIELDS:
            e, a = exp.get(f), act.get(f)
            if e is not None and values_match(f, e, a):
                fields[f]["tp"] += 1
            else:
                fields[f]["fn"] += e is not None
                fields[f]["fp"] += a is not None
                fields[f]["halluc"] += e is None and a is not None
        tp, fp, fn = line_item_counts(exp.get("line_items") or [], act.get("line_items") or [])
        items.update(tp=tp, fp=fp, fn=fn)
        if j is not None:
            review["total"] += 1
            review["correct"] += (act.get("status") == "needs_review") == exp[
                "expected_needs_review"
            ]
    for j, act in enumerate(actual):  # invoices nobody expected: every value is a hallucination
        if j not in matched:
            for f in FIELDS:
                if act.get(f) is not None:
                    fields[f]["fp"] += 1
                    fields[f]["halluc"] += 1
    want = set(label["expected_issues"])
    defective = any(c["fp"] or c["fn"] for c in fields.values()) or bool(items["fp"] or items["fn"])
    return {
        "file": name,
        "routing": {
            "applicable": bool(expected or actual),
            "defective": defective,  # any wrong or missing field or line item
            "flagged": any(a.get("status") == "needs_review" for a in actual),
            "review_expected": any(e.get("expected_needs_review") for e in expected),
        },
        "fields": {f: {k: int(v) for k, v in c.items() if v} for f, c in fields.items()},
        "line_items": dict(items),
        "review": dict(review),
        "invoice_count": {"expected": len(expected), "actual": len(actual)},
        "status": {"expected": label["expected_status"], "actual": doc_status},
        "rules": {
            "expected": sorted(want),
            "actual": sorted(issues_seen),
            "exact": want == issues_seen,
        },  # fmt: skip
    }


def ratio(num: float, den: float) -> float | None:
    return None if not den else num / den


def routing_summary(scored: list[dict]) -> dict:
    """Does review flagging follow real extraction errors? Files with any wrong or missing value
    should be flagged; fully correct files should not. Independent of what the labels expect."""
    used = [s for s in scored if s.get("routing", {}).get("applicable")]
    bad = [s for s in used if s["routing"]["defective"]]
    good = [s for s in used if not s["routing"]["defective"]]
    flagged_bad = [s for s in bad if s["routing"]["flagged"]]
    # a correct file flagged because its label expects review (duplicates, inconsistent
    # documents) is a justified flag, not a false alarm
    flagged_good = [
        s for s in good if s["routing"]["flagged"] and not s["routing"].get("review_expected")
    ]
    return {
        "defective_files": len(bad),
        "defective_flagged": len(flagged_bad),
        "silently_ready": sorted(s.get("file", "?") for s in bad if not s["routing"]["flagged"]),
        "correct_files": len(good),
        "correct_flagged": len(flagged_good),
        "correct_flagged_names": sorted(s.get("file", "?") for s in flagged_good),
        "routing_accuracy": ratio(len(flagged_bad) + len(good) - len(flagged_good), len(used)),
    }


def merge_rows(base: list[dict], overlay: list[dict]) -> list[dict]:
    """`overlay` rows replace `base` rows of the same file; everything else is kept in order."""
    fresh = {r["file"]: r for r in overlay}
    merged = [fresh.pop(r["file"], r) for r in base]
    return merged + list(fresh.values())


def aggregate(scored: list[dict]) -> dict:
    """Sum per-file counts into field metrics, review accuracy, rule accuracy and doc rates."""
    per_field = {}
    for f in FIELDS:
        tp = sum(s["fields"][f].get("tp", 0) for s in scored)
        fp = sum(s["fields"][f].get("fp", 0) for s in scored)
        fn = sum(s["fields"][f].get("fn", 0) for s in scored)
        per_field[f] = {
            "tp": tp, "fp": fp, "fn": fn,
            "hallucinated": sum(s["fields"][f].get("halluc", 0) for s in scored),
            "precision": ratio(tp, tp + fp), "recall": ratio(tp, tp + fn),
        }  # fmt: skip
    li = {k: sum(s["line_items"].get(k, 0) for s in scored) for k in ("tp", "fp", "fn")}
    rules: dict[str, Counter] = defaultdict(Counter)
    for s in scored:
        exp, act = set(s["rules"]["expected"]), set(s["rules"]["actual"])
        for rule in exp | act:
            rules[rule]["tp"] += rule in exp and rule in act
            rules[rule]["fp"] += rule not in exp and rule in act
            rules[rule]["fn"] += rule in exp and rule not in act
    rule_stats = {
        r: {
            **c,
            "precision": ratio(c["tp"], c["tp"] + c["fp"]),
            "recall": ratio(c["tp"], c["tp"] + c["fn"]),
        }  # fmt: skip
        for r, c in sorted(rules.items())
    }
    done = len(scored)
    return {
        "files": done,
        "routing": routing_summary(scored),
        "fields": per_field,
        "line_items": {
            **li,
            "precision": ratio(li["tp"], li["tp"] + li["fp"]),
            "recall": ratio(li["tp"], li["tp"] + li["fn"]),
        },  # fmt: skip
        "needs_review_accuracy": ratio(
            sum(s["review"].get("correct", 0) for s in scored),
            sum(s["review"].get("total", 0) for s in scored),
        ),  # fmt: skip
        "rules": rule_stats,
        "rule_set_exact_match": ratio(sum(s["rules"]["exact"] for s in scored), done),
        "status_match": ratio(
            sum(s["status"]["expected"] == s["status"]["actual"] for s in scored), done
        ),  # fmt: skip
        "invoice_count_match": ratio(
            sum(s["invoice_count"]["expected"] == s["invoice_count"]["actual"] for s in scored),
            done,
        ),  # fmt: skip
    }


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q * len(ordered)) - 1)]


def stage_timings(events_by_file: dict[str, list[dict]]) -> dict:
    """p50 / p95 duration_ms of succeeded stage events across files (latest job only)."""
    ms: dict[str, list[float]] = defaultdict(list)
    for events in events_by_file.values():
        for ev in events:
            if ev["status"] == "succeeded" and ev.get("duration_ms") is not None:
                ms[ev["stage"]].append(ev["duration_ms"])
    return {s: {"n": len(ms[s]), "p50_ms": percentile(ms[s], 0.5),
                "p95_ms": percentile(ms[s], 0.95)}
            for s in STAGES if ms[s]}  # fmt: skip


def token_totals(events_by_file: dict[str, list[dict]]) -> dict[str, dict[str, int]]:
    out = {}
    for name, events in events_by_file.items():
        prompt = sum((e.get("detail") or {}).get("prompt_tokens", 0) for e in events
                     if e["stage"] == "fields" and e["status"] == "succeeded")  # fmt: skip
        completion = sum((e.get("detail") or {}).get("completion_tokens", 0) for e in events
                         if e["stage"] == "fields" and e["status"] == "succeeded")  # fmt: skip
        out[name] = {"prompt": prompt, "completion": completion}
    return out


# ---------------------------------------------------------------- reporting (pure)


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def routing_lines(r: dict | None) -> list[str]:
    if not r or not (r["defective_files"] or r["correct_files"]):
        return []
    silent = ", ".join(r["silently_ready"]) or "none"
    return [
        f"- Review routing (does flagging follow real errors?): {pct(r['routing_accuracy'])}",
        f"  - files with any extraction error flagged for review: {r['defective_flagged']} of "
        f"{r['defective_files']}; silently ready: {silent}",
        f"  - fully correct files flagged although the label expects no review: "
        f"{r['correct_flagged']} of "
        f"{r['correct_files']}",
    ]


def render_report(results: dict) -> str:
    lines = ["# LedQuill evaluation report", ""]
    meta = results["meta"]
    lines += [
        f"Run: {meta['started_at']}  |  files run: {meta['files_run']} of "
        f"{meta['files_in_dataset']}"
        f"  |  subset: {'yes' if meta['subset'] else 'no'}",
        "",
        "All numbers are measured by `evaluation/run_eval.py` against `labels.json` through the "
        "real API. `n/a` means the metric had no data. Synthetic and real files are reported "
        "separately and never blended.",
        "",
        "Label policy: scan_11 to scan_15 (severe scans) are expected to need review, as a rule "
        "that does not depend on the system's output. Their field labels still describe the "
        "printed invoice, so unreadable values count as misses, not as passes.",
        "",
    ]
    if meta.get("rescored_at"):
        rerun = ", ".join(meta.get("rerun_files") or []) or "none"
        lines += [f"Rescored with the current scorer at {meta['rescored_at']}; files run again "
                  f"afterwards: {rerun}.", ""]  # fmt: skip
    for kind in ("synthetic", "real"):
        sec = results[kind]
        lines += [f"## {kind.capitalize()} files", ""]
        if not sec["files"]:
            lines += [f"No {kind} files were run.", ""]
            continue
        agg = sec["aggregate"]
        lines += [
            f"- Files: {agg['files']}; document status as expected: {pct(agg['status_match'])}; "
            f"invoice count as expected: {pct(agg['invoice_count_match'])}",
            f"- needs_review accuracy (matched invoices): {pct(agg['needs_review_accuracy'])}",
            f"- Validation rule sets exactly right per file: {pct(agg['rule_set_exact_match'])}",
            *routing_lines(agg.get("routing")),
            "",
            "| Field | Precision | Recall | TP | FP | FN | Hallucinated |",
            "|---|---|---|---|---|---|---|",
        ]
        for f, m in agg["fields"].items():
            lines.append(f"| {f} | {pct(m['precision'])} | {pct(m['recall'])} | {m['tp']} | "
                         f"{m['fp']} | {m['fn']} | {m['hallucinated']} |")  # fmt: skip
        li = agg["line_items"]
        lines += [f"| line items (by amount) | {pct(li['precision'])} | {pct(li['recall'])} | "
                  f"{li['tp']} | {li['fp']} | {li['fn']} | - |", ""]  # fmt: skip
        if agg["rules"]:
            lines += ["| Rule | Precision | Recall | TP | FP | FN |", "|---|---|---|---|---|---|"]
            lines += [f"| {r} | {pct(m['precision'])} | {pct(m['recall'])} | {m['tp']} | "
                      f"{m['fp']} | "
                      f"{m['fn']} |" for r, m in agg["rules"].items()]  # fmt: skip
            lines.append("")
    t = results["timing"]
    lines += ["## Timing", "", "| Stage | n | p50 ms | p95 ms |", "|---|---|---|---|"]
    for stage, m in t["stages"].items():
        lines.append(f"| {stage} | {m['n']} | {m['p50_ms']} | {m['p95_ms']} |")
    e2e = t["end_to_end_s"]
    lines += ["", f"End to end (upload to terminal status): p50 {e2e['p50']} s, p95 {e2e['p95']} s "
              f"over {e2e['n']} files.", ""]  # fmt: skip
    tk = results["tokens"]
    lines += ["## LLM tokens (actual, as reported by the providers)", "",
              f"Prompt {tk['prompt']}, completion {tk['completion']}, total {tk['total']} "
              f"across {tk['files_with_llm']} files that called a model.", ""]  # fmt: skip
    lines += ["## Per file", "", "| File | Group | Status (expected/actual) | Invoices (exp/act) | "
              "Seconds |", "|---|---|---|---|---|"]  # fmt: skip
    for row in results["files"]:
        lines.append(f"| {row['file']} | {row['group']} | {row['score']['status']['expected']}/"
                     f"{row['score']['status']['actual']} | "
                     f"{row['score']['invoice_count']['expected']}/"
                     f"{row['score']['invoice_count']['actual']} | {row['seconds']} |")  # fmt: skip
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- HTTP (I/O)


class Client:
    def __init__(self, base: str, key: str) -> None:
        import httpx  # noqa: PLC0415

        self.http = httpx.Client(base_url=base, headers={"X-API-Key": key}, timeout=60)

    def request(self, method: str, url: str, **kw):
        """One call; 429 and 503 wait (Retry-After, else exponential backoff) and retry."""
        for attempt in range(8):
            r = self.http.request(method, url, **kw)
            if r.status_code not in (429, 503):
                return r
            wait = float(r.headers.get("Retry-After") or min(60, 2**attempt))
            print(
                f"  {r.status_code} on {method} {url.split('?')[0]}: waiting {wait:.0f}s",
                flush=True,
            )
            time.sleep(wait)
        return r

    def upload(self, path: Path):
        data = path.read_bytes()  # bytes, not a handle: a 429 retry must resend the whole file
        return self.request("POST", f"{API}/documents", files=[("files", (path.name, data))])

    def wait(self, document_id: str, timeout: float = 900) -> dict:
        start = time.monotonic()
        while time.monotonic() - start < timeout:
            doc = self.request("GET", f"{API}/documents/{document_id}").json()
            if doc["status"] in TERMINAL:
                return doc
            time.sleep(2)
        return {"status": "timeout", "error": f"no result after {timeout:.0f}s"}

    def invoices(self, document_id: str) -> list[dict]:
        r = self.request(
            "GET", f"{API}/invoices", params={"document_id": document_id, "limit": 100}
        )
        r.raise_for_status()
        return r.json()["items"]

    def events(self, document_id: str) -> list[dict]:
        r = self.request("GET", f"{API}/documents/{document_id}/events", params={"limit": 100})
        r.raise_for_status()
        items = r.json()["items"]
        last_job = items[-1]["job_id"] if items else None
        return [e for e in items if e["job_id"] == last_job]


class Pacer:
    """Keeps the last 60 s of actual tokens under a share of one model's TPM limit."""

    def __init__(self) -> None:
        self.window: deque[tuple[float, int]] = deque()
        self.total = 0

    def record(self, tokens: int) -> None:
        self.window.append((time.monotonic(), tokens))
        self.total += tokens

    def wait(self) -> None:
        budget = TPM_LIMIT * TPM_SHARE
        while True:
            now = time.monotonic()
            while self.window and now - self.window[0][0] > 60:
                self.window.popleft()
            if sum(t for _, t in self.window) + EST_TOKENS_PER_FILE <= budget or not self.window:
                return
            time.sleep(max(1.0, 61 - (now - self.window[0][0])))


# ---------------------------------------------------------------- main


def select(labels: dict, only: str | None, limit: int | None, partners: bool = True) -> list[str]:
    names = sorted(labels, key=lambda n: labels[n]["upload_order"])
    if only:
        wanted = {w.strip() for w in only.split(",") if w.strip()}
        names = [n for n in names if labels[n]["group"] in wanted or n in wanted]
    if limit is not None:
        names = names[:limit]
    chosen = set(names)
    for n in (
        list(names) if partners else []
    ):  # a partner must exist for a depends_on file, so pull it in
        for partner in labels[n].get("depends_on") or []:
            chosen.add(partner)
    return sorted(chosen, key=lambda n: labels[n]["upload_order"])


def load_labels() -> tuple[dict, dict]:
    synthetic = json.loads((DATA / "labels.json").read_text(encoding="utf-8"))
    real_path = DATA / "real" / "labels_real.json"
    real = json.loads(real_path.read_text(encoding="utf-8")) if real_path.exists() else {}
    return synthetic, real


def run_file(client: Client, pacer: Pacer, name: str, label: dict, path: Path) -> dict:
    pacer.wait()
    began = time.monotonic()
    resp = client.upload(path)
    body = resp.json()
    if resp.status_code != 202 or not body.get("accepted"):
        rejected = (body.get("rejected") or [{}])[0] if isinstance(body, dict) else {}
        status = "rejected"
        detail = rejected.get("reason") or str(body)[:200]
        score = score_file(label, [], status, set(), name)
        return {"file": name, "group": label["group"], "document_id": None, "error": detail,
                "http_status": rejected.get("status", resp.status_code), "events": [],
                "seconds": round(time.monotonic() - began, 1), "score": score}  # fmt: skip
    document_id = body["accepted"][0]["document_id"]
    doc = client.wait(document_id)
    seconds = round(time.monotonic() - began, 1)
    invoices = client.invoices(document_id) if doc["status"] == "completed" else []
    events = client.events(document_id)
    issues = {i["rule_id"] for inv in invoices for i in inv["issues"]}
    tokens = token_totals({name: events})[name]
    pacer.record(tokens["prompt"] + tokens["completion"])
    return {"file": name, "group": label["group"], "document_id": document_id,
            "error": doc.get("error"), "events": events, "seconds": seconds,
            "score": score_file(label, invoices, doc["status"], issues, name)}  # fmt: skip


def build_results(rows: list[dict], total_files: int, subset: bool, started: str) -> dict:
    def section(kind: str) -> dict:
        part = [r for r in rows if r["kind"] == kind]
        return {"files": [r["file"] for r in part],
                "aggregate": aggregate([r["score"] for r in part]) if part else None}  # fmt: skip

    events = {r["file"]: r["events"] for r in rows}
    tokens = token_totals(events)
    seconds = [r["seconds"] for r in rows if r["score"]["status"]["actual"] != "rejected"]
    prompt = sum(t["prompt"] for t in tokens.values())
    completion = sum(t["completion"] for t in tokens.values())
    return {
        "meta": {
            "started_at": started,
            "files_run": len(rows),
            "files_in_dataset": total_files,
            "subset": subset,
        },  # fmt: skip
        "synthetic": section("synthetic"),
        "real": section("real"),
        "timing": {
            "stages": stage_timings(events),
            "end_to_end_s": {
                "n": len(seconds),
                "p50": percentile(seconds, 0.5),
                "p95": percentile(seconds, 0.95),
            },
        },  # fmt: skip
        "tokens": {
            "prompt": prompt,
            "completion": completion,
            "total": prompt + completion,
            "files_with_llm": sum(1 for t in tokens.values() if t["prompt"]),
        },  # fmt: skip
        "files": rows,
    }


def rescore_run(client: Client, out_json: Path, out_md: Path, labels: dict, merge_from) -> int:
    """No uploads and no LLM calls: optionally merge rows from another results file, then score
    every stored document again from the API with the current scorer and labels."""
    if not out_json.exists():
        print(f"{out_json.name} does not exist; nothing to rescore.", file=sys.stderr)
        return 2
    previous = json.loads(out_json.read_text(encoding="utf-8"))
    rows, rerun = previous["files"], []
    if merge_from:
        overlay = json.loads((HERE / merge_from).read_text(encoding="utf-8"))["files"]
        rows, rerun = merge_rows(rows, overlay), [r["file"] for r in overlay]
    rows = [r for r in rows if r["file"] in labels]
    for row in rows:
        name, document_id = row["file"], row.get("document_id")
        if not document_id:  # rejected at upload: nothing stored to read back
            row["score"] = score_file(labels[name], [], "rejected", set(), name)
            continue
        response = client.request("GET", f"{API}/documents/{document_id}")
        if response.status_code != 200:
            print(f"{name}: document {document_id} is gone (HTTP {response.status_code})")
            return 2
        status = response.json()["status"]
        invoices = client.invoices(document_id) if status == "completed" else []
        issues = {i["rule_id"] for inv in invoices for i in inv["issues"]}
        row["score"] = score_file(labels[name], invoices, status, issues, name)
    results = build_results(
        rows, len(labels), len(rows) < len(labels), previous["meta"]["started_at"]
    )
    results["meta"].update(rescored_at=datetime.now(UTC).isoformat(timespec="seconds"),
                           rerun_files=rerun)  # fmt: skip
    out_json.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    out_md.write_text(render_report(results), encoding="utf-8")
    print(
        f"Rescored {len(rows)} file(s) ({len(rerun)} merged); wrote {out_json.name}, {out_md.name}"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--only")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--tag")
    ap.add_argument("--max-tokens", type=int, default=150_000)
    ap.add_argument(
        "--no-partners",
        action="store_true",
        help="do not pull in depends_on partners (they are already uploaded)",
    )
    ap.add_argument(
        "--rescore",
        action="store_true",
        help="no uploads: re-read every stored document from the API and score again",
    )
    ap.add_argument(
        "--merge-from",
        metavar="FILE",
        help="with --rescore: rows of this results file replace the same files",
    )
    args = ap.parse_args(argv)

    key = os.environ.get("LEDQUILL_API_KEY", "")
    if not key:
        print("LEDQUILL_API_KEY is not set in this environment.", file=sys.stderr)
        return 2
    suffix = f".{args.tag}" if args.tag else ""
    out_json, out_md = HERE / f"results{suffix}.json", HERE / f"report{suffix}.md"

    synthetic, real = load_labels()
    labels = {**synthetic, **real}
    kinds = {**dict.fromkeys(synthetic, "synthetic"), **dict.fromkeys(real, "real")}
    if args.rescore:
        return rescore_run(Client(args.base_url, key), out_json, out_md, labels, args.merge_from)
    names = select(labels, args.only, args.limit, partners=not args.no_partners)
    rows: list[dict] = []
    if args.resume and out_json.exists():
        previous = json.loads(out_json.read_text(encoding="utf-8"))["files"]
        rows = [
            r
            for r in previous
            if r["file"] in names and r["score"]["status"]["actual"] != "timeout"
        ]
    done = {r["file"] for r in rows}
    todo = [n for n in names if n not in done]
    print(f"{len(todo)} file(s) to run ({len(done)} resumed, {len(labels)} in dataset)", flush=True)

    client, pacer, started = (
        Client(args.base_url, key),
        Pacer(),
        datetime.now(UTC).isoformat(timespec="seconds"),
    )
    spent = token_totals({r["file"]: r["events"] for r in rows}).values()
    pacer.total = sum(t["prompt"] + t["completion"] for t in spent)  # --max-tokens spans resumes
    finished: dict[str, str] = {r["file"]: r["score"]["status"]["actual"] for r in rows}
    for n, name in enumerate(todo, 1):
        if pacer.total >= args.max_tokens:
            print(f"Stopping: {pacer.total} tokens spent, --max-tokens is {args.max_tokens}.")
            break
        for partner in [] if args.no_partners else labels[name].get("depends_on") or []:
            if finished.get(partner) != "completed":
                print(f"  note: partner {partner} has not completed; {name} still uploaded")
        path = (DATA / "real" / name) if kinds[name] == "real" else (DATA / name)
        row = run_file(client, pacer, name, labels[name], path)
        row["kind"] = kinds[name]
        rows.append(row)
        finished[name] = row["score"]["status"]["actual"]
        s = row["score"]
        print(f"[{n}/{len(todo)}] {name}: {s['status']['actual']} "
              f"(expected {s['status']['expected']}), "
              f"invoices {s['invoice_count']['actual']}/{s['invoice_count']['expected']}, "
              f"{row['seconds']}s, tokens so far {pacer.total}", flush=True)  # fmt: skip
        partial = build_results(rows, len(labels), len(rows) < len(labels), started)
        out_json.write_text(json.dumps(partial,
                                       indent=2, default=str), encoding="utf-8")  # fmt: skip
    results = build_results(rows, len(labels), len(rows) < len(labels), started)
    out_json.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    out_md.write_text(render_report(results), encoding="utf-8")
    print(f"Wrote {out_json.name} and {out_md.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
