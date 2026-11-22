import uuid
from datetime import date
from decimal import Decimal as D

import pytest

from app.pipeline.validate import (
    Candidate,
    InvoiceData,
    Issue,
    LineData,
    cross_check_issues,
    derive_status,
    duplicate_issues,
    normalize_supplier,
    validate_fields,
    within_tolerance,
)

TODAY = date(2026, 11, 22)
GOOD_CONF = {"invoice_number": 0.95, "invoice_date": 0.95, "supplier_name": 0.95, "total": 0.95}


def invoice(**overrides) -> InvoiceData:
    base = {
        "invoice_number": "INV-1", "invoice_date": date(2026, 9, 1), "supplier_name": "Acme Ltd",
        "subtotal": D("1000.00"), "tax": D("150.00"), "total": D("1150.00"),
        "line_items": [LineData("Paper", D("10"), D("100"), D("1000.00"))],
        "confidence": GOOD_CONF,
    }  # fmt: skip
    return InvoiceData(**{**base, **overrides})


def rules_of(issues: list[Issue]) -> list[str]:
    return [i.rule_id for i in issues]


def check(inv: InvoiceData, **kw) -> list[Issue]:
    return validate_fields(inv, today=TODAY, **kw)


def test_a_clean_invoice_has_no_issues_and_is_ready():
    issues = check(invoice())
    assert issues == [] and derive_status(issues) == "ready"


# V-01
@pytest.mark.parametrize("name", ["invoice_number", "invoice_date", "supplier_name", "total"])
def test_missing_required_field_flags_v01(name):
    issues = check(invoice(**{name: None}))
    v01 = [i for i in issues if i.rule_id == "V-01"]
    assert [(i.severity, i.field) for i in v01] == [("error", name)]
    assert "missing" in v01[0].message


# V-02
def test_negative_amounts_flag_v02_and_zero_passes():
    assert "V-02" not in rules_of(check(invoice(tax=D("0.00"), total=D("1000.00"))))
    issues = check(invoice(tax=D("-5.00"), total=D("995.00")))
    assert [i.field for i in issues if i.rule_id == "V-02"] == ["tax"]
    line = LineData("x", D("1"), D("-5"), D("-5"))
    assert "V-02" in rules_of(check(invoice(line_items=[line], subtotal=None, tax=None)))


def test_unknown_currency_code_is_a_v02_warning_and_known_or_missing_passes():
    issues = check(invoice(currency="XXZ"))
    assert [(i.rule_id, i.severity, i.field) for i in issues] == [("V-02", "warning", "currency")]
    assert issues[0].actual == "XXZ"
    assert check(invoice(currency="BDT")) == [] and check(invoice(currency=None)) == []
    assert derive_status(issues) == "ready"  # one warning alone does not need review


# V-03
def test_line_math_mismatch_is_a_v03_warning_and_matching_lines_pass():
    bad = LineData("Paper", D("10"), D("100"), D("999.00"))
    issues = check(invoice(line_items=[bad], subtotal=None, tax=None, total=D("999.00")))
    v03 = next(i for i in issues if i.rule_id == "V-03")
    assert v03.severity == "warning" and v03.expected == "1,000.00" and v03.actual == "999.00"
    assert "V-03" not in rules_of(check(invoice()))
    partial = LineData("Paper", D("10"), None, D("999.00"))
    assert "V-03" not in rules_of(check(invoice(line_items=[partial], subtotal=None, tax=None)))


# V-04
def test_line_sum_not_equal_subtotal_flags_v04():
    items = [LineData("a", None, None, D("400.00")), LineData("b", None, None, D("500.00"))]
    issues = check(invoice(line_items=items))
    v04 = next(i for i in issues if i.rule_id == "V-04")
    assert (v04.severity, v04.expected, v04.actual) == ("error", "900.00", "1,000.00")
    items[1] = LineData("b", None, None, D("600.00"))
    assert "V-04" not in rules_of(check(invoice(line_items=items)))


def test_v04_is_skipped_when_a_line_amount_is_missing():
    items = [LineData("a", None, None, D("400.00")), LineData("b", None, None, None)]
    assert "V-04" not in rules_of(check(invoice(line_items=items)))


# V-05
def test_total_mismatch_flags_v05_with_expected_and_actual():
    issues = check(invoice(total=D("1200.00")))
    v05 = next(i for i in issues if i.rule_id == "V-05")
    assert v05.severity == "error" and (v05.expected, v05.actual) == ("1,150.00", "1,200.00")
    assert "1,000.00" in v05.message and "150.00" in v05.message and "1,200.00" in v05.message
    assert derive_status(issues) == "needs_review"


def test_v05_is_not_computed_when_a_printed_number_is_missing():
    assert "V-05" not in rules_of(check(invoice(tax=None, total=D("1200.00"))))


@pytest.mark.parametrize(
    ("a", "b", "ok"),
    [
        ("1.00", "1.00", True), ("1.01", "1.00", True), ("1.02", "1.00", False),
        ("100000.00", "100500.00", True),  # 0.5% of 100,500 is 502.50
        ("100000.00", "100502.50", True), ("100000.00", "100503.00", False),
        ("10.05", "10.00", True), ("10.06", "10.00", False),  # 0.5% of 10 is 0.05
    ],
)  # fmt: skip
def test_tolerance_is_max_of_one_cent_and_half_a_percent(a, b, ok):
    assert within_tolerance(D(a), D(b)) is ok


def test_tolerance_edge_decides_v05():
    on_edge = invoice(subtotal=D("100000.00"), tax=D("0.00"), total=D("100500.00"), line_items=[])
    assert "V-05" not in rules_of(check(on_edge))
    over = invoice(subtotal=D("100000.00"), tax=D("0.00"), total=D("100600.00"), line_items=[])
    assert "V-05" in rules_of(check(over))


# V-06
def test_future_and_ancient_dates_are_v06_warnings():
    future = check(invoice(invoice_date=date(2027, 1, 1)))
    assert [(i.rule_id, i.severity) for i in future] == [("V-06", "warning")]
    ancient = check(invoice(invoice_date=date(1999, 12, 31)))
    assert rules_of(ancient) == ["V-06"]
    assert check(invoice(invoice_date=TODAY)) == []
    assert check(invoice(invoice_date=date(2000, 1, 1))) == []


# V-08
def test_low_confidence_on_a_required_field_flags_v08_and_needs_review():
    issues = check(invoice(confidence={**GOOD_CONF, "total": 0.69}))
    assert [(i.rule_id, i.field) for i in issues] == [("V-08", "total")]
    assert derive_status(issues) == "needs_review"  # one low-confidence warning is enough
    assert check(invoice(confidence={**GOOD_CONF, "total": 0.7})) == []


def test_missing_values_are_v01_only_not_also_low_confidence():
    issues = check(invoice(total=None, confidence={}))
    assert "V-08" not in rules_of([i for i in issues if i.field == "total"])


def test_llm_unavailable_and_injection_add_review_warnings():
    assert rules_of(check(invoice(), llm_unavailable=True)) == ["V-08"]
    issues = check(invoice(), injection_lines=2)
    assert rules_of(issues) == ["V-08"] and "instructions" in issues[0].message


# status
def test_two_warnings_need_review_one_warning_alone_does_not():
    warn = Issue("V-06", "warning", "w")
    assert derive_status([warn]) == "ready"
    assert derive_status([warn, warn]) == "needs_review"
    assert derive_status([Issue("V-05", "error", "e")]) == "needs_review"


# V-07
def candidate(**overrides) -> Candidate:
    base = {
        "invoice_id": uuid.uuid4(), "document_id": uuid.uuid4(), "filename": "other.pdf",
        "sha256": "b" * 64, "invoice_number": "INV-1", "invoice_date": date(2026, 9, 1),
        "supplier_norm": "acme ltd", "total": D("1150.00"),
    }  # fmt: skip
    return Candidate(**{**base, **overrides})


DOC = uuid.uuid4()
SHA = "a" * 64


def dupes(inv, *cands):
    return duplicate_issues(inv, document_id=DOC, sha256=SHA, candidates=cands)


def test_same_supplier_and_number_is_a_v07_duplicate_with_the_related_invoice():
    other = candidate()
    (issue,) = dupes(invoice(), other)
    assert (issue.rule_id, issue.severity, issue.related_invoice_id) == (
        "V-07", "error", other.invoice_id,
    )  # fmt: skip
    assert "INV-1" in issue.message and "other.pdf" in issue.message


def test_supplier_matching_ignores_case_and_punctuation():
    assert normalize_supplier("  ACME,  Ltd. ") == "acme ltd"
    assert dupes(invoice(supplier_name="ACME, Ltd."), candidate())


def test_same_file_hash_in_another_document_is_a_v07_duplicate():
    other = candidate(sha256=SHA, invoice_number="INV-99", supplier_norm="zeta")
    (issue,) = dupes(invoice(), other)
    assert issue.rule_id == "V-07" and "exact file" in issue.message


def test_same_hash_in_the_same_document_is_not_a_duplicate():
    assert dupes(invoice(), candidate(sha256=SHA, document_id=DOC, supplier_norm="zeta")) == []


def test_other_supplier_or_number_is_not_a_duplicate():
    assert dupes(invoice(), candidate(supplier_norm="other co")) == []
    assert dupes(invoice(), candidate(invoice_number="INV-2")) == []
    assert dupes(invoice(invoice_number=None), candidate(invoice_number=None)) == []


# V-09
def cross(inv, *cands):
    return cross_check_issues(inv, document_id=DOC, candidates=cands)


def test_agreeing_copies_in_two_sources_raise_nothing():
    assert cross(invoice(), candidate()) == []


def test_total_date_and_supplier_differences_each_raise_v09():
    other = candidate(
        total=D("1100.00"), invoice_date=date(2026, 9, 2), supplier_norm="acme limited"
    )
    issues = cross(invoice(), other)
    assert sorted(i.field for i in issues) == ["invoice_date", "supplier_name", "total"]
    assert all(i.rule_id == "V-09" and i.related_invoice_id == other.invoice_id for i in issues)
    total = next(i for i in issues if i.field == "total")
    assert (total.expected, total.actual) == ("1,100.00", "1,150.00")
    assert "other.pdf" in total.message


def test_total_within_tolerance_is_not_a_mismatch():
    assert cross(invoice(), candidate(total=D("1150.01"))) == []


def test_same_number_from_an_unrelated_supplier_is_not_cross_checked():
    assert cross(invoice(), candidate(supplier_norm="zzz holdings", total=D("5.00"))) == []


def test_cross_check_ignores_the_same_document_and_missing_numbers():
    assert cross(invoice(), candidate(document_id=DOC, total=D("5.00"))) == []
    assert cross(invoice(invoice_number=None), candidate(total=D("5.00"))) == []
