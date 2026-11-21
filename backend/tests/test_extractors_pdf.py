"""PDF extraction contract: 1-based pages, honest scanned detection, engine fallback."""

from __future__ import annotations

import pytest

from app.extractors import ExtractionError
from app.extractors.pdf import PdfExtractor
from app.models import ProcessingStatus, SegmentStatus

from tests.fixtures.pdfs import PAGE_ONE_TEXT, one_page_pdf, two_page_pdf


@pytest.fixture(scope="module")
def pdf_bytes() -> bytes:
    return two_page_pdf()


def test_pages_are_one_based_and_labeled(pdf_bytes: bytes) -> None:
    result = PdfExtractor().extract(data=pdf_bytes, filename="paper.pdf")
    assert [segment.segment_index for segment in result.segments] == [1, 2]
    assert [segment.segment_label for segment in result.segments] == ["Page 1", "Page 2"]


def test_first_page_text_is_extracted(pdf_bytes: bytes) -> None:
    result = PdfExtractor().extract(data=pdf_bytes, filename="paper.pdf")
    assert PAGE_ONE_TEXT in result.segments[0].content
    assert result.segments[0].extraction_status is SegmentStatus.ok
    assert result.segments[0].is_scanned is False


def test_vector_only_page_is_flagged_as_scanned(pdf_bytes: bytes) -> None:
    result = PdfExtractor().extract(data=pdf_bytes, filename="paper.pdf")
    page_two = result.segments[1]
    assert page_two.content == ""
    assert page_two.is_scanned is True
    assert page_two.extraction_status is SegmentStatus.scanned


def test_partial_status_and_integrity_banner(pdf_bytes: bytes) -> None:
    result = PdfExtractor().extract(data=pdf_bytes, filename="paper.pdf")
    assert result.status is ProcessingStatus.partial
    summary = result.integrity_summary()
    assert summary["segments"] == 2
    assert summary["scanned"] == 1
    assert summary["scanned_labels"] == ["Page 2"]
    assert summary["partial"] is True
    assert summary["engine"] in {"pymupdf", "pypdf"}


def test_engine_is_reported_honestly(pdf_bytes: bytes) -> None:
    result = PdfExtractor().extract(data=pdf_bytes, filename="paper.pdf")
    assert result.engine in {"pymupdf", "pypdf"}
    assert result.metadata["page_count"] == 2


def test_single_text_page_is_ready_not_partial() -> None:
    result = PdfExtractor().extract(data=one_page_pdf("Only page"), filename="one.pdf")
    assert len(result.segments) == 1
    assert result.status is ProcessingStatus.ready
    assert result.integrity_summary()["partial"] is False


def test_missing_bytes_raises_clearly() -> None:
    with pytest.raises(ExtractionError) as excinfo:
        PdfExtractor().extract(text="not a pdf")
    assert "bytes" in str(excinfo.value)


def test_corrupt_pdf_raises_with_engine_detail() -> None:
    with pytest.raises(ExtractionError) as excinfo:
        PdfExtractor().extract(data=b"%PDF-1.4 definitely not a pdf")
    message = str(excinfo.value)
    assert "no PDF engine could read" in message
    assert "pypdf" in message  # the fallback attempt is named, not hidden


def test_extractor_declares_pdf_support() -> None:
    extractor = PdfExtractor()
    assert extractor.supports(filename="x.PDF") is True
    assert extractor.supports(mime_type="application/pdf") is True
    assert extractor.supports(source_format=None, mime_type="text/plain") is False
