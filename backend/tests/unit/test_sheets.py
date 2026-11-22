import pytest
from openpyxl import Workbook

from app.core.errors import PermanentError
from app.pipeline.sheets import detect_header_row, read_sheets


def test_xlsx_every_sheet_becomes_a_page(fixtures_dir):
    sheets = read_sheets(fixtures_dir / "two_sheets.xlsx", "xlsx")
    assert [(s.index, s.name) for s in sheets] == [(1, "March"), (2, "April")]
    assert "INV-1001\t2026-03-14\tNorthwind Traders Ltd\t1250" in sheets[0].text
    assert "INV-2001" in sheets[1].text


def test_title_rows_above_the_header_are_skipped_when_finding_it(fixtures_dir):
    first, second = read_sheets(fixtures_dir / "two_sheets.xlsx", "xlsx")
    assert first.text.splitlines()[first.header_row] == "Invoice No\tDate\tSupplier\tAmount"
    assert first.header_row == 1  # the title row has one text cell
    assert second.header_row == 0


def test_legacy_xls_is_read(fixtures_dir):
    (sheet,) = read_sheets(fixtures_dir / "legacy.xls", "xls")
    assert "INV-3001" in sheet.text and "310.25" in sheet.text
    assert sheet.header_row == 0


def test_csv_in_cp1252_with_semicolons_is_decoded_and_split(fixtures_dir):
    (sheet,) = read_sheets(fixtures_dir / "cp1252.csv", "csv")
    lines = sheet.text.splitlines()
    assert lines[0] == "Rechnung\tDatum\tLieferant\tBetrag"
    assert lines[1].split("\t")[2:] == ["Müller GmbH", "1250,00 €"]
    assert sheet.header_row == 0


def test_utf8_bom_csv_with_commas(tmp_path):
    path = tmp_path / "bom.csv"
    path.write_bytes("﻿Invoice,Date,Supplier\nINV-1,2026-01-02,Zoë Ltd\n".encode())
    (sheet,) = read_sheets(path, "csv")
    assert sheet.text.splitlines()[0] == "Invoice\tDate\tSupplier"
    assert "Zoë Ltd" in sheet.text


def test_header_needs_three_non_empty_text_cells():
    rows = [["Report"], ["Total", "123"], ["No", "Date", "Supplier"], ["1", "x", "y"]]
    assert detect_header_row(rows) == 2


def test_numeric_and_date_cells_do_not_count_as_header_text():
    assert detect_header_row([["2026-01-01", "100", "12.50", "x"]]) is None


def test_sheet_without_a_header_still_yields_text(tmp_path):
    path = tmp_path / "numbers.csv"
    path.write_text("1,2,3\n4,5,6\n")
    (sheet,) = read_sheets(path, "csv")
    assert sheet.header_row is None and sheet.row_count == 2


def test_empty_sheets_are_skipped_but_keep_their_position(tmp_path):
    wb = Workbook()
    wb.active.title = "Empty"
    data = wb.create_sheet("Data")
    data.append(["A", "B", "C"])
    data.append(["x", "y", "z"])
    path = tmp_path / "gap.xlsx"
    wb.save(path)
    sheets = read_sheets(path, "xlsx")
    assert [(s.index, s.name) for s in sheets] == [(2, "Data")]


def test_workbook_with_no_data_is_a_permanent_error(tmp_path):
    path = tmp_path / "blank.xlsx"
    Workbook().save(path)
    with pytest.raises(PermanentError, match="no data"):
        read_sheets(path, "xlsx")


def test_corrupt_xlsx_is_a_permanent_error(tmp_path):
    path = tmp_path / "bad.xlsx"
    path.write_bytes(b"PK\x03\x04 not really a workbook")
    with pytest.raises(PermanentError, match="damaged"):
        read_sheets(path, "xlsx")


def test_corrupt_xls_is_a_permanent_error(tmp_path):
    path = tmp_path / "bad.xls"
    path.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64)
    with pytest.raises(PermanentError):
        read_sheets(path, "xls")


def test_csv_that_is_not_text_is_a_permanent_error(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_bytes(b"a,b\n\x81\x8d\x8f\x90\x9d,x\n")  # bytes undefined in cp1252 and UTF-8
    with pytest.raises(PermanentError, match="encoding"):
        read_sheets(path, "csv")
