#!/usr/bin/env python3
"""
Fast unit test for the PDF generator helper in scripts/smoke_test.py.

Verifies the generator works offline without a live server:
- Creates a 2-page PDF in memory
- Page 1 contains the phrase
- Page 2 has no text (vector only)
"""

import io
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    import pytest
    pytest.skip("pypdf not installed", allow_module_level=True)

# Try to import the smoke_test module
try:
    sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
    from smoke_test import generate_test_pdf
except ImportError:
    import pytest
    pytest.skip("smoke_test dependencies not available (reportlab)", allow_module_level=True)


def test_generate_test_pdf_creates_two_pages() -> None:
    """generate_test_pdf returns bytes for a 2-page PDF."""
    phrase = "TEST-PHRASE-123"
    pdf_bytes = generate_test_pdf(phrase)

    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 1000  # reasonable size

    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) == 2


def test_generate_test_pdf_page1_has_phrase() -> None:
    """Page 1 contains the unique searchable phrase."""
    phrase = "UNIQUE-PHRASE-XYZ"
    pdf_bytes = generate_test_pdf(phrase)

    reader = PdfReader(io.BytesIO(pdf_bytes))
    page1_text = reader.pages[0].extract_text()

    assert phrase in page1_text
    assert "Page 1" in page1_text
    assert "NEXUS Smoke Test Document" in page1_text


def test_generate_test_pdf_page2_no_text() -> None:
    """Page 2 is vector-only (no extractable text)."""
    phrase = "SHOULD-NOT-APPEAR"
    pdf_bytes = generate_test_pdf(phrase)

    reader = PdfReader(io.BytesIO(pdf_bytes))
    page2_text = reader.pages[1].extract_text()

    # Page 2 should have no meaningful text (maybe whitespace)
    assert phrase not in page2_text
    assert "Page 2" not in page2_text
    # Should be essentially empty or just whitespace
    assert page2_text.strip() == ""
