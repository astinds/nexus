"""DOCX extraction: heading sections, tables, empty-document honesty."""

from __future__ import annotations

import io

import pytest

from app.extractors.docx import DocxExtractor
from app.models import ProcessingStatus, SegmentStatus


def _docx_bytes(*, with_table: bool = True, empty: bool = False) -> bytes:
    import docx

    document = docx.Document()
    if not empty:
        document.add_heading("Executive Summary", level=1)
        document.add_paragraph("This brief argues that cooling demand triples by 2040.")
        document.add_heading("Evidence", level=2)
        document.add_paragraph("Household survey of 4,000 respondents.")
        document.add_paragraph("Grid load data from 2015 to 2024.")
        if with_table:
            table = document.add_table(rows=2, cols=2)
            table.cell(0, 0).text = "Year"
            table.cell(0, 1).text = "Peak MW"
            table.cell(1, 0).text = "2024"
            table.cell(1, 1).text = "1820"
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def test_headings_become_sections() -> None:
    result = DocxExtractor().extract(data=_docx_bytes(), filename="brief.docx")
    labels = [segment.segment_label for segment in result.segments]
    # The document opens with a heading, so there is no preamble: the first
    # heading is the first section, not a phantom empty "Body".
    assert labels[0] == "Executive Summary"
    assert "Body" not in labels
    assert "Evidence" in labels
    assert result.engine == "python-docx"


def test_segment_indexes_are_one_based() -> None:
    result = DocxExtractor().extract(data=_docx_bytes(), filename="brief.docx")
    assert [segment.segment_index for segment in result.segments] == list(
        range(1, len(result.segments) + 1)
    )


def test_tables_are_searchable_text() -> None:
    result = DocxExtractor().extract(data=_docx_bytes(), filename="brief.docx")
    table_segments = [s for s in result.segments if s.segment_label.startswith("Table")]
    assert table_segments, "a table should produce its own segment"
    assert "Year | Peak MW" in table_segments[0].content
    assert "2024 | 1820" in table_segments[0].content


def test_status_is_ready_when_every_section_has_text() -> None:
    result = DocxExtractor().extract(data=_docx_bytes(), filename="brief.docx")
    assert result.status is ProcessingStatus.ready


def test_empty_document_is_reported_not_hidden() -> None:
    result = DocxExtractor().extract(data=_docx_bytes(empty=True), filename="empty.docx")
    assert result.status is ProcessingStatus.partial
    assert any("empty" in warning.lower() for warning in result.warnings)
    assert result.segments[0].extraction_status is SegmentStatus.empty


def test_missing_bytes_raises() -> None:
    from app.extractors import ExtractionError

    with pytest.raises(ExtractionError):
        DocxExtractor().extract(text="not a docx")


def test_corrupt_docx_raises_with_reason() -> None:
    from app.extractors import ExtractionError

    with pytest.raises(ExtractionError) as excinfo:
        DocxExtractor().extract(data=b"PK\x03\x04 broken")
    assert "readable .docx" in str(excinfo.value)


def test_extractor_claims_docx_only() -> None:
    extractor = DocxExtractor()
    assert extractor.supports(filename="report.DOCX") is True
    assert extractor.supports(filename="report.pdf") is False
