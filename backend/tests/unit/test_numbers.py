from decimal import Decimal as D

import pytest

from app.llm.grounding import ground
from app.pipeline.numbers import amount_candidates, parse_amount, source_numbers
from app.schemas.extraction import ExtractionResult


@pytest.mark.parametrize(
    ("printed", "value"),
    [
        ("BDT 10,50,125.00", D("1050125.00")),  # Indian grouping
        ("11,28,884.38", D("1128884.38")),
        ("1,00,000", D("100000")),
        ("12,34,56,789.50", D("123456789.50")),
        ("1,250.00", D("1250.00")),  # unchanged styles
        ("1.250,00", D("1250.00")),
        ("1 250,00", D("1250.00")),
        ("12,345,678.00", D("12345678.00")),
        ("78,759.38", D("78759.38")),
        ("12.5", D("12.5")),
    ],
)
def test_amounts_parse_in_every_grouping_style(printed, value):
    assert parse_amount(printed) == value


def test_indian_grouping_is_one_number_not_two():
    assert source_numbers("Subtotal BDT 10,50,125.00") == {D("1050125.00")}
    assert amount_candidates("10,50,125") == [D("1050125")]
    assert amount_candidates("1,250") == [D("1250"), D("1.250")]  # still ambiguous, as before


def test_grounding_keeps_values_printed_with_indian_grouping():
    source = "Subtotal BDT 10,50,125.00\nVAT 78,759.38\nTotal 11,28,884.38"
    fields = {"subtotal": "1050125.00", "tax": "78759.38", "total": "1128884.38"}
    llm = ExtractionResult.model_validate({**fields, "confidence": dict.fromkeys(fields, 0.9)})
    report = ground(llm, source)
    assert report.nulled == []
    assert (report.result.subtotal, report.result.total) == (D("1050125.00"), D("1128884.38"))
