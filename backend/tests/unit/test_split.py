from app.pipeline.split import PageText, split_document


def pages(*texts: str, method: str = "text") -> list[PageText]:
    return [PageText(n, method, t) for n, t in enumerate(texts, 1)]


def test_a_new_invoice_number_starts_a_new_invoice():
    segments = split_document(pages("Invoice No: INV-1\nTotal 5", "Invoice No: INV-2\nTotal 7"))
    assert [s.page_numbers for s in segments] == [[1], [2]]


def test_repeated_header_with_the_same_number_is_a_continuation_page():
    segments = split_document(
        pages("Invoice No: INV-1\nline", "Invoice No: INV-1\nPage 2", "Invoice No: INV-2")
    )
    assert [s.page_numbers for s in segments] == [[1, 2], [3]]


def test_page_without_a_number_joins_the_current_invoice():
    segments = split_document(pages("Invoice No: INV-1", "terms and conditions", "Invoice #INV-2"))
    assert [s.page_numbers for s in segments] == [[1, 2], [3]]


def test_leading_page_without_a_number_adopts_the_first_number():
    segments = split_document(pages("Cover note", "Invoice No: INV-1", "Invoice No: INV-1"))
    assert [s.page_numbers for s in segments] == [[1, 2, 3]]


def test_document_without_any_number_is_one_invoice():
    segments = split_document(pages("hello", "world"))
    assert [s.page_numbers for s in segments] == [[1, 2]]
    assert segments[0].text == "hello\n\nworld"


def test_number_comparison_ignores_case_and_spaces():
    segments = split_document(pages("Invoice No: inv-1", "Invoice No: INV-1"))
    assert len(segments) == 1


def sheet(*rows: list[str]) -> list[PageText]:
    return pages("\n".join("\t".join(r) for r in rows), method="sheet")


HEADER = ["Inv No", "Date", "Vendor", "Total"]


def test_sheet_rows_are_grouped_by_invoice_number_including_blank_continuations():
    segments = split_document(
        sheet(
            HEADER,
            ["A-1", "2026-01-01", "Acme", "10"],
            ["", "", "", "5"],  # continuation of A-1
            ["B-2", "2026-01-02", "Beta", "20"],
            ["A-1", "2026-01-01", "Acme", "7"],  # same number later: same invoice
        )
    )
    assert len(segments) == 2
    assert [len(s.table.rows) for s in segments] == [3, 1]
    assert segments[0].table.header == HEADER


def test_sheet_without_an_invoice_number_column_makes_one_invoice_per_row():
    segments = split_document(
        sheet(
            ["Supplier", "Date", "Amount", "Currency"],
            ["Acme", "2026-01-01", "10", "USD"],
            ["Beta", "2026-01-02", "20", "EUR"],
        )  # fmt: skip
    )
    assert len(segments) == 2


def test_sheet_without_a_header_is_one_invoice_and_keeps_its_text():
    segments = split_document(sheet(["Invoice No:"], ["Total:"]))
    assert len(segments) == 1 and segments[0].table is None
    assert "Invoice No:" in segments[0].text


def test_sheet_with_a_header_but_no_data_rows_is_one_invoice():
    segments = split_document(sheet(HEADER))
    assert len(segments) == 1 and segments[0].table is None


def test_rows_above_the_header_stay_in_each_invoice_text():
    segments = split_document(
        sheet(["Acme Ltd register"], HEADER, ["A-1", "2026-01-01", "Acme", "10"])
    )
    assert segments[0].text.startswith("Acme Ltd register")


def test_each_sheet_is_split_separately_and_keeps_its_sheet_number():
    both = [
        PageText(1, "sheet", "\t".join(HEADER) + "\nA-1\t2026-01-01\tAcme\t10"),
        PageText(2, "sheet", "\t".join(HEADER) + "\nB-2\t2026-02-01\tBeta\t20"),
    ]
    assert [s.page_numbers for s in split_document(both)] == [[1], [2]]
