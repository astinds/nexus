"""Pure-Python extractors: segment generation, empty handling, honest warnings."""

from __future__ import annotations

import json

import pytest

from app.extractors import available, resolve
from app.extractors.note import NativeNoteExtractor
from app.extractors.text import TextStructuredExtractor
from app.models import ProcessingStatus, SourceFormat


def test_markdown_splits_into_heading_sections() -> None:
    result = TextStructuredExtractor().extract(
        text="# One\nalpha\n\n## Two\nbeta\n", filename="doc.md"
    )
    assert result.engine == "markdown-sections"
    assert [segment.segment_label for segment in result.segments] == ["One", "Two"]
    assert result.segments[0].segment_index == 1
    assert result.word_count > 0


def test_single_section_label_is_note_body() -> None:
    result = TextStructuredExtractor().extract(text="plain text only")
    assert [segment.segment_label for segment in result.segments] == ["Note Body"]


def test_segment_indexes_are_one_based_and_contiguous() -> None:
    body = "\n\n".join(f"## Section {i}\ncontent {i}" for i in range(1, 6))
    result = TextStructuredExtractor().extract(text=body)
    assert [segment.segment_index for segment in result.segments] == [1, 2, 3, 4, 5]


def test_csv_rows_become_searchable_segments() -> None:
    result = TextStructuredExtractor().extract(
        data=b"title,year\nPolicy A,2020\nPolicy B,2021\n", filename="data.csv"
    )
    assert result.engine == "csv-stdlib"
    labels = [segment.segment_label for segment in result.segments]
    assert labels == ["Header", "Row 1", "Row 2"]
    assert "title: Policy B" in result.segments[2].content


def test_json_object_keys_become_segments() -> None:
    payload = json.dumps({"alpha": 1, "beta": [1, 2]}).encode()
    result = TextStructuredExtractor().extract(data=payload, filename="data.json")
    assert [segment.segment_label for segment in result.segments] == ["alpha", "beta"]


def test_invalid_json_is_reported_not_swallowed() -> None:
    result = TextStructuredExtractor().extract(data=b"{not json", filename="data.json")
    assert any("Invalid JSON" in warning for warning in result.warnings)


def test_empty_document_is_flagged_empty() -> None:
    result = TextStructuredExtractor().extract(text="   ")
    assert result.segments[0].extraction_status.value == "empty"
    assert result.status is ProcessingStatus.partial
    assert any("empty" in warning.lower() for warning in result.warnings)


def test_html_is_reduced_to_text() -> None:
    markup = b"<html><head><style>x{}</style></head><body><h1>Title</h1><p>Body text</p></body></html>"
    result = TextStructuredExtractor().extract(data=markup, filename="page.html")
    joined = " ".join(segment.content for segment in result.segments)
    assert "Body text" in joined
    assert "x{}" not in joined


def test_native_note_indexes_on_edit() -> None:
    result = NativeNoteExtractor().extract(text="# Note\nfirst line\n")
    assert result.engine == "native-note"
    assert result.segments[0].segment_label == "Note"
    assert result.status is ProcessingStatus.ready


def test_native_note_empty_needs_enrichment() -> None:
    result = NativeNoteExtractor().extract(text="")
    assert result.status is ProcessingStatus.needs_enrichment
    assert result.segments[0].extraction_status.value == "empty"


def test_integrity_summary_is_honest_about_scan_pages() -> None:
    result = NativeNoteExtractor().extract(text="ok content")
    summary = result.integrity_summary()
    assert summary["segments"] == 1
    assert summary["partial"] is False
    assert summary["engine"] == "native-note"


def test_registry_resolves_by_format_extension_and_mime() -> None:
    assert resolve(source_format=SourceFormat.note).name == "native_note"
    assert resolve(filename="a.md").name == "text_structured"
    assert resolve(mime_type="text/csv").name == "text_structured"


def test_registry_lists_available_extractors() -> None:
    names = [row["name"] for row in available()]
    assert "native_note" in names
    assert "text_structured" in names


def test_registry_routes_each_container_to_its_own_extractor() -> None:
    assert resolve(source_format=SourceFormat.pdf).name == "pdf"
    assert resolve(source_format=SourceFormat.docx).name == "docx"
    assert resolve(source_format=SourceFormat.web_article).name == "web_article"
    assert resolve(filename="x.docx").name == "docx"


def test_unknown_format_raises_extraction_error() -> None:
    from app.extractors import ExtractionError

    with pytest.raises(ExtractionError) as excinfo:
        resolve(mime_type="application/vnd.oasis.opendocument.text", filename="x.odt")
    assert "no extractor" in str(excinfo.value)
