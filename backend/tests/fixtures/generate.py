"""Regenerates the small binary fixtures in this folder (fixed seed, deterministic).

Run inside the api container:  python -m tests.fixtures.generate
The generated files are committed; tests never call this module except for its constants.
Needs xlwt (dev-only) for the .xls file.
"""

import zipfile
from pathlib import Path

import numpy as np
import pymupdf
import xlwt
from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent

PAGE_LINES = [
    "INVOICE",
    "Invoice No: INV-1001",
    "Date: 2026-03-14",
    "Supplier: Northwind Traders Ltd",
    "Total Due: 1250.00 USD",
]
SECOND_PAGE_LINES = [
    "INVOICE",
    "Invoice No: INV-2002",
    "Date: 2026-04-02",
    "Supplier: Contoso Supplies",
    "Total Due: 480.50 EUR",
]
SHEET_HEADER = ["Invoice No", "Date", "Supplier", "Amount"]


def text_image(lines: list[str], size=(1240, 700), font_size=44) -> Image.Image:
    img = Image.new("L", size, 255)
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=font_size)
    for i, line in enumerate(lines):
        draw.text((80, 70 + i * (font_size + 40)), line, fill=0, font=font)
    return img


def make_pdfs() -> None:
    doc = pymupdf.open()
    for lines in (PAGE_LINES, SECOND_PAGE_LINES):
        page = doc.new_page()
        for i, line in enumerate(lines):
            page.insert_text((72, 96 + i * 28), line, fontsize=14)
    doc.save(HERE / "digital.pdf")

    protected = pymupdf.open()
    protected.new_page().insert_text((72, 96), "secret invoice", fontsize=14)
    protected.save(
        HERE / "encrypted.pdf",
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="user-secret",
        owner_pw="owner-secret",
    )
    (HERE / "corrupt.pdf").write_bytes(b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\ngarbage" * 3)
    (HERE / "empty.pdf").write_bytes(b"")


def make_images() -> None:
    clean = text_image(PAGE_LINES)
    clean.save(HERE / "scanned.png", optimize=True)

    rng = np.random.default_rng(7)
    skewed = text_image(PAGE_LINES).rotate(3, expand=False, fillcolor=255, resample=Image.BICUBIC)
    noisy = np.asarray(skewed, dtype=np.float32) + rng.normal(0, 18, (700, 1240))
    Image.fromarray(np.clip(noisy, 0, 255).astype(np.uint8)).save(
        HERE / "rotated_noisy.jpg", quality=55
    )

    first, second = text_image(PAGE_LINES), text_image(SECOND_PAGE_LINES)
    first.save(
        HERE / "multiframe.tif", save_all=True, append_images=[second], compression="tiff_lzw"
    )


def make_sheets() -> None:
    wb = Workbook()
    first = wb.active
    first.title = "March"
    first.append(["Acme Ltd - Invoice Register"])  # title row above the header
    first.append([])
    first.append(SHEET_HEADER)
    first.append(["INV-1001", "2026-03-14", "Northwind Traders Ltd", 1250.0])
    first.append(["INV-1002", "2026-03-15", "Contoso Supplies", 99.5])
    second = wb.create_sheet("April")
    second.append(SHEET_HEADER)
    second.append(["INV-2001", "2026-04-02", "Fabrikam", 480.5])
    wb.save(HERE / "two_sheets.xlsx")

    legacy = xlwt.Workbook()
    sheet = legacy.add_sheet("Register")
    for r, row in enumerate([SHEET_HEADER, ["INV-3001", "2026-05-01", "Tailspin Toys", 310.25]]):
        for c, value in enumerate(row):
            sheet.write(r, c, value)
    legacy.save(str(HERE / "legacy.xls"))

    rows = [
        "Rechnung;Datum;Lieferant;Betrag",
        "RE-1001;14.03.2026;Müller GmbH;1250,00 €",
        "RE-1002;15.03.2026;Café Société;99,50 €",
    ]
    (HERE / "cp1252.csv").write_bytes("\n".join(rows).encode("cp1252"))


def make_disguises(target: Path) -> dict[str, Path]:
    """Files whose names lie about their content; built on demand by the tests."""
    docx = target / "report.xlsx"
    with zipfile.ZipFile(docx, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document/>")
    archive = target / "archive.xlsx"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("notes.txt", "hello")
    pdf_as_jpg = target / "invoice.jpg"
    pdf_as_jpg.write_bytes((HERE / "digital.pdf").read_bytes())
    text_as_pdf = target / "invoice.pdf"
    text_as_pdf.write_text("This is only a plain sentence, not a PDF at all.\n")
    return {
        "docx_as_xlsx": docx,
        "zip_as_xlsx": archive,
        "pdf_as_jpg": pdf_as_jpg,
        "text_as_pdf": text_as_pdf,
    }


if __name__ == "__main__":
    make_pdfs()
    make_images()
    make_sheets()
    for path in sorted(HERE.iterdir()):
        if path.suffix and path.suffix != ".py":
            print(f"{path.name}: {path.stat().st_size} bytes")
