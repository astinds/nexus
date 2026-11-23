"""Hostile and malformed input, generated in memory.

No binary fixtures live in git: every hostile file here is assembled from bytes
or from pypdf's writer at test time, so a reviewer can read exactly what the
extractor is being fed.

Covered:
  * mixed pages — text, vector-only (scanned) and truly blank, on one document;
  * encrypted / password-protected PDFs;
  * truncated, corrupted-header and renamed non-PDF files.
"""

from __future__ import annotations

import io

from tests.fixtures.pdfs import _stream, one_page_pdf

MIXED_PAGE_TEXT = "MIXED TEXT PAGE MARKER"


def _assemble(objects: list[str], header: bytes = b"%PDF-1.4\n") -> bytes:
    out = bytearray(header)
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1"))
    xref_start = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    out.extend(b"0000000000 65535 f \n")
    for offset in offsets:
        out.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    out.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_start}\n%%EOF\n"
        ).encode("latin-1")
    )
    return bytes(out)


def mixed_three_page_pdf() -> bytes:
    """Page 1 text, page 2 vector-only (scanned), page 3 blank (no operators)."""
    page1 = f"BT /F1 18 Tf 72 700 Td ({MIXED_PAGE_TEXT}) Tj ET"
    page2 = "0.2 0.3 0.4 rg 72 500 300 200 re f"
    page3 = " "  # whitespace only: no drawing operators, so the page is empty

    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 8 0 R >> >> /Contents 6 0 R >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 7 0 R >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 9 0 R >>",
        _stream(page1),
        _stream(page2),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        _stream(page3),
    ]
    return _assemble(objects)


def encrypted_pdf(password: str = "s3cret-passphrase") -> bytes:
    """A real encrypted PDF, produced by pypdf at test time.

    RC4 rather than AES: AES needs the optional `cryptography` package, which is
    not installed everywhere this suite runs, and both are equally "needs a
    password" from the extractor's point of view.
    """
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(one_page_pdf("ENCRYPTED BODY")))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password=password, algorithm="RC4-128")
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def truncated_pdf() -> bytes:
    """The first 60 bytes of a valid PDF: header intact, body and xref gone."""
    return one_page_pdf("TRUNCATED")[:60]


def corrupted_header_pdf() -> bytes:
    """Plausible size, unusable structure: xref points nowhere and objects are junk."""
    return b"%PDF-1.7\n" + b"\x00\xff" * 400


def html_renamed_to_pdf() -> bytes:
    """A web page saved with a .pdf extension — the classic mislabelled upload."""
    return (
        b"<!DOCTYPE html><html><head><title>Not a PDF</title></head>"
        b"<body><p>This is HTML, not a PDF.</p></body></html>"
    )
