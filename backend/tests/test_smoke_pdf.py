#!/usr/bin/env python3
"""
Fast unit test for the PDF generator helper in scripts/smoke_test.py.

Verifies the generator works offline without a live server:
- Creates a 2-page PDF in memory
- Page 1 contains the phrase
- Page 2 has vector content but no text (is_scanned=True)
- PdfExtractor classifies Page 1 as `ok` and Page 2 as `is_scanned=True`
"""

import io
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    import pytest
    pytest.skip("pypdf not installed", allow_module_level=True)

# Import the smoke_test module
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from smoke_test import generate_test_pdf

# Import the PdfExtractor from the backend app
from app.extractors.pdf import PdfExtractor  # noqa: E402
from app.models.common import SegmentStatus  # noqa: E402


def test_generate_test_pdf_creates_two_pages() -> None:
    """generate_test_pdf returns bytes for a 2-page PDF."""
    phrase = "TEST-PHRASE-123"
    pdf_bytes = generate_test_pdf(phrase)

    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 500  # minimal valid PDF size

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
    """Page 2 has vector content but no extractable text."""
    phrase = "SHOULD-NOT-APPEAR"
    pdf_bytes = generate_test_pdf(phrase)

    reader = PdfReader(io.BytesIO(pdf_bytes))
    page2_text = reader.pages[1].extract_text()

    # Page 2 should have no meaningful text (maybe whitespace)
    assert phrase not in page2_text
    assert "Page 2" not in page2_text
    # Should be essentially empty or just whitespace
    assert page2_text.strip() == ""


def test_pdf_extractor_classifies_pages() -> None:
    """PdfExtractor must classify Page 1 as `ok` and Page 2 as `is_scanned=True`."""
    phrase = "EXTRACTOR-TEST-PHRASE"
    pdf_bytes = generate_test_pdf(phrase)

    extractor = PdfExtractor()
    result = extractor.extract(data=pdf_bytes)

    # Must produce exactly 2 segments
    assert len(result.segments) == 2

    page1, page2 = result.segments

    # Page 1: text present → status ok, is_scanned=False
    assert page1.segment_label == "Page 1"
    assert page1.extraction_status == SegmentStatus.ok
    assert page1.is_scanned is False
    assert phrase in page1.content

    # Page 2: no text but vector drawing → status scanned, is_scanned=True
    assert page2.segment_label == "Page 2"
    assert page2.extraction_status == SegmentStatus.scanned
    assert page2.is_scanned is True
    assert page2.content == ""
