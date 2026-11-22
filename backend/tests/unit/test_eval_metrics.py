"""The evaluation scorer's pure functions (evaluation/run_eval.py). No API, no LLM."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "evaluation" / "run_eval.py"
if not SCRIPT.exists():
    pytest.skip("evaluation/run_eval.py is not mounted here", allow_module_level=True)
spec = importlib.util.spec_from_file_location("run_eval", SCRIPT)
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)


def label(invoices, status="completed", issues=()):
    return {
        "expected_invoices": invoices,
        "expected_status": status,
        "expected_issues": list(issues),
    }


def exp(**kw):
    base = dict.fromkeys(ev.FIELDS)
    return {**base, "line_items": [], "expected_needs_review": False, **kw}


def act(status="ready", items=(), **kw):
    return {**dict.fromkeys(ev.FIELDS), "status": status, "line_items": list(items), **kw}


def test_value_matching_rules():
    assert ev.values_match("total", "100.00", "100.01")
    assert not ev.values_match("total", "100", "100.02")
    assert ev.values_match("invoice_number", "INV-1", "INV-1")
    assert not ev.values_match("invoice_number", "INV-1", "inv-1")  # ids are exact
    assert ev.values_match("supplier_name", "Acme Ltd.", "ACME Limited")  # normalised fuzzy
    assert not ev.values_match("supplier_name", "Acme Ltd", "Zenith Corp")
    assert ev.values_match("tax", None, None) and not ev.values_match("tax", None, "1.00")


def test_blank_template_with_an_invented_invoice_counts_as_hallucination():
    invented = act(supplier_name="Phantom Ltd", total="500.00")
    s = ev.score_file(label([]), [invented], "completed", set())
    assert s["fields"]["supplier_name"]["halluc"] == 1 and s["fields"]["total"]["fp"] == 1
    clean = ev.score_file(label([]), [], "completed", set())
    assert sum(c.get("halluc", 0) for c in clean["fields"].values()) == 0


def test_field_counts_and_precision_recall():
    e = exp(invoice_number="A-1", total="10.00", supplier_name="Acme Ltd")
    a = act(invoice_number="A-1", total="99.00", supplier_name=None)
    s = ev.score_file(label([e]), [a], "completed", set())
    assert s["fields"]["invoice_number"] == {"tp": 1}
    assert s["fields"]["total"] == {"fn": 1, "fp": 1}  # wrong value is both a miss and an error
    assert s["fields"]["supplier_name"] == {"fn": 1}
    agg = ev.aggregate([s])
    assert agg["fields"]["invoice_number"]["precision"] == 1.0
    assert agg["fields"]["total"]["recall"] == 0.0
    assert agg["fields"]["tax"]["precision"] is None  # no data is n/a, not 0


def test_invoices_are_paired_by_number_then_by_order():
    expected = [exp(invoice_number="B"), exp(invoice_number=None)]
    actual = [act(invoice_number="C"), act(invoice_number="B")]
    assert ev.match_invoices(expected, actual) == [(0, 1), (1, 0)]
    assert ev.match_invoices([exp(), exp()], [act()]) == [(0, 0), (1, None)]


def test_line_items_match_by_amount_within_a_cent():
    tp, fp, fn = ev.line_item_counts(
        [{"amount": "10.00"}, {"amount": "5.50"}], [{"amount": "10.004"}, {"amount": "7.00"}]
    )
    assert (tp, fp, fn) == (1, 1, 1)


def test_needs_review_status_and_rule_accuracy():
    wrong = ev.score_file(label([exp(expected_needs_review=True)], issues=["V-05"]),
                          [act(status="ready")], "completed", {"V-01"})  # fmt: skip
    right = ev.score_file(label([exp()], issues=["V-01"]), [act()], "failed", {"V-01"})
    agg = ev.aggregate([wrong, right])
    assert agg["needs_review_accuracy"] == 0.5 and agg["status_match"] == 0.5
    assert agg["rules"]["V-05"]["fn"] == 1 and agg["rules"]["V-01"]["fp"] == 1
    assert agg["rules"]["V-01"]["tp"] == 1 and agg["rule_set_exact_match"] == 0.5


def test_percentiles_and_stage_timings_ignore_failed_events():
    assert ev.percentile([], 0.5) is None
    values = [10, 20, 30, 40]
    assert ev.percentile(values, 0.5) == 20 and ev.percentile(values, 0.95) == 40
    events = {"f": [
        {"stage": "extract", "status": "succeeded", "duration_ms": 100},
        {"stage": "extract", "status": "failed", "duration_ms": 9999},
        {"stage": "fields", "status": "succeeded", "duration_ms": 50,
         "detail": {"prompt_tokens": 70, "completion_tokens": 30}},
    ]}  # fmt: skip
    assert ev.stage_timings(events)["extract"] == {"n": 1, "p50_ms": 100, "p95_ms": 100}
    assert ev.token_totals(events) == {"f": {"prompt": 70, "completion": 30}}


def test_selection_pulls_in_depends_on_partners_and_report_separates_real():
    labels = {
        "a.pdf": {"upload_order": 1, "group": "clean", "depends_on": None},
        "b.pdf": {"upload_order": 2, "group": "duplicate", "depends_on": ["a.pdf"]},
        "c.pdf": {"upload_order": 3, "group": "scan", "depends_on": None},
    }
    assert ev.select(labels, "duplicate", None) == ["a.pdf", "b.pdf"]
    assert ev.select(labels, None, 1) == ["a.pdf"]
    results = ev.build_results([], 3, True, "now")
    report = ev.render_report(results)
    assert "No synthetic files were run." in report and "No real files were run." in report
