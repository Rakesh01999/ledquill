from datetime import date
from decimal import Decimal

import pytest

from app.pipeline.rules import (
    extract_hints,
    extract_table,
    find_invoice_number,
    map_columns,
    parse_date_prefix,
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Invoice No: INV-1042", "INV-1042"),
        ("INVOICE NUMBER  2026/0042.", "2026/0042"),
        ("Invoice #: 5588", "5588"),
        ("Tax Invoice No. A-17", "A-17"),
        ("Invoice Date: 2026-01-01", None),  # not a number label
        ("Invoice No:\nDate:", None),  # label with no value, never the next line
        ("Invoice not paid yet", None),
    ],
)
def test_invoice_number_patterns(text, expected):
    assert find_invoice_number(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2026-03-14", date(2026, 3, 14)),
        ("14/03/2026", date(2026, 3, 14)),  # 14 cannot be a month: day first
        ("03/14/2026", date(2026, 3, 14)),  # 14 cannot be a month: month first
        ("14.03.26", date(2026, 3, 14)),
        ("14 March 2026", date(2026, 3, 14)),
        ("March 14, 2026", date(2026, 3, 14)),
        ("14-Mar-2026", date(2026, 3, 14)),
        ("03/03/2026", date(2026, 3, 3)),  # same either way
        ("03/04/2026", None),  # ambiguous: never guess
        ("31/02/2026", None),  # impossible
    ],
)
def test_date_formats(text, expected):
    assert parse_date_prefix(text) == expected


def test_invoice_date_is_read_by_label_and_the_due_date_is_ignored():
    hints = extract_hints("Due Date: 2026-05-01\nInvoice Date: 2026-04-01\n")
    assert hints.values["invoice_date"] == date(2026, 4, 1)
    assert "invoice_date" not in extract_hints("Due Date: 2026-05-01").values


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Total USD 100", "USD"),
        ("Amount in EUR", "EUR"),
        ("Total €100", "EUR"),
        ("Total $100", None),  # $ could be USD, CAD or AUD
        ("USD and EUR both appear", None),
    ],
)
def test_currency_detection(text, expected):
    assert extract_hints(text).values.get("currency") == expected


def test_labelled_totals_are_read_from_their_lines():
    text = "Sub Total: 1,000.00\nVAT (15%): 150.00\nTotal Due: 1,150.00 USD"
    values = extract_hints(text).values
    assert values["subtotal"] == Decimal("1000.00")
    assert values["tax"] == Decimal("150.00")
    assert values["total"] == Decimal("1150.00")


def test_sub_total_is_never_read_as_the_total():
    assert "total" not in extract_hints("Sub Total: 1,000.00").values


def test_strong_total_label_beats_a_plain_total_line():
    values = extract_hints("Total 10\nGrand Total: 1,150.00\nTotal 99").values
    assert values["total"] == Decimal("1150.00")


def test_european_number_format_is_understood():
    assert extract_hints("Total: 1.250,50").values["total"] == Decimal("1250.50")


def test_tax_invoice_header_does_not_become_a_tax_amount():
    assert "tax" not in extract_hints("Tax Invoice No: INV-1001").values


def test_empty_template_yields_no_hints_at_all():
    text = "Invoice No:\nInvoice Date:\nSupplier:\nCustomer:\nTotal:"
    assert extract_hints(text).values == {}


def test_synonym_headers_map_to_fields():
    mapped = map_columns(["Inv No", "Bill Date", "Vendor", "Client", "Net", "VAT", "Grand Total"])
    assert mapped == {
        "invoice_number": 0, "invoice_date": 1, "supplier_name": 2, "customer_name": 3,
        "subtotal": 4, "tax": 5, "total": 6,
    }  # fmt: skip


def test_a_lone_amount_column_is_the_total_unless_lines_exist():
    assert map_columns(["Invoice", "Amount"])["total"] == 1
    lines = map_columns(["Invoice", "Description", "Qty", "Amount"])
    assert "total" not in lines and lines["line_amount"] == 3


def test_table_rows_become_fields_and_line_items():
    header = ["Invoice #", "Date", "Supplier", "Description", "Qty", "Price", "Line Total", "Total"]
    rows = [
        ["A-1", "2026-01-05", "Acme", "Paper", "2", "10.00", "20.00", "50.00"],
        ["", "", "", "Ink", "1", "30.00", "30.00", ""],
    ]
    result = extract_table(header, rows)
    assert result.complete
    assert result.values == {
        "invoice_number": "A-1", "supplier_name": "Acme", "invoice_date": date(2026, 1, 5),
        "total": Decimal("50.00"),
    }  # fmt: skip
    assert [i["description"] for i in result.line_items] == ["Paper", "Ink"]
    assert result.line_items[1]["amount"] == Decimal("30.00")


def test_table_missing_cells_stay_missing_and_unmapped_total_is_not_complete():
    result = extract_table(["Invoice", "Vendor", "Date"], [["A-1", "", ""]])
    assert result.values == {"invoice_number": "A-1"}
    assert not result.complete


def test_bill_labels_and_a_number_on_the_next_line_are_invoice_numbers():
    assert find_invoice_number("BILL #\nA-3274\nINVOICE DATE") == "A-3274"
    assert find_invoice_number("Bill #: INV-2026-9842") == "INV-2026-9842"
    assert find_invoice_number("BILL TO\nCorvane Motors 304") is None
    assert find_invoice_number("Invoice No\nDate 2026-01-01") is None
