"""Hand-built PDF fixtures.

No PDF library can add text without a full writer, so the smoke fixture is assembled
byte by byte. That keeps the test honest: the same bytes go through pypdf (and PyMuPDF
where it loads), and the expected result is fixed.

Page 1 carries real text; page 2 is a vector-only page (a filled rectangle) with no
text at all, which is exactly the "scanned / image-only" case the extractor must flag.
"""

from __future__ import annotations

PAGE_ONE_TEXT = "NEXUS PAGE ONE MARKER"


def _stream(content: str) -> str:
    return f"<< /Length {len(content)} >>\nstream\n{content}\nendstream"


def two_page_pdf(text: str = PAGE_ONE_TEXT) -> bytes:
    """A valid 2-page PDF: page 1 has text, page 2 is vector-only (no text)."""
    page_one_body = f"BT /F1 18 Tf 72 700 Td ({text}) Tj ET"
    page_two_body = "0.2 0.3 0.4 rg 72 500 300 200 re f"

    objects: list[str] = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << >> /Contents 6 0 R >>",
        _stream(page_one_body),
        _stream(page_two_body),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
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


def one_page_pdf(text: str) -> bytes:
    """Single text page; useful when only page numbering matters."""
    body = f"BT /F1 12 Tf 72 700 Td ({text}) Tj ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        _stream(body),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{number} 0 obj\n{obj}\nendobj\n".encode("latin-1"))
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
