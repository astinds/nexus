"""Export: Obsidian-ready frontmatter, JSON round-trip, citations, backup ZIP."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from uuid import UUID

import pytest

from app.errors import ApiError
from app.models import ExportFormat
from app.services import export as export_service

ITEM_ID = UUID("11111111-2222-3333-4444-555555555555")

ITEM = {
    "id": ITEM_ID,
    "title": "Cooling Demand: 2024 Review",
    "source_format": "web_article",
    "triage_status": "reading",
    "processing_status": "ready",
    "word_count": 812,
    "est_read_minutes": 4,
    "source_uri": "https://example.org/cooling",
    "snapshot_uri": "local://ws/abc/snapshot.html",
    "content_hash": "a" * 64,
    "summary": "Peak load overtakes baseload in three states.",
    "custom_fields": {"author": "A. Researcher", "year": 2024, "verified": True},
    "reading_progress": {"segment_index": 2, "percent": 42.5},
    "metadata": {"url": "https://example.org/cooling"},
    "created_at": datetime(2024, 5, 1, 9, 0, tzinfo=timezone.utc),
    "updated_at": datetime(2024, 5, 2, 10, 0, tzinfo=timezone.utc),
}

SEGMENTS = [
    {
        "segment_index": 1,
        "segment_label": "Article",
        "content": "Household air-conditioning ownership rose.",
        "is_scanned": False,
        "extraction_status": "ok",
    },
    {
        "segment_index": 2,
        "segment_label": "Why it matters",
        "content": "",
        "is_scanned": True,
        "extraction_status": "scanned",
    },
]


def test_markdown_starts_with_yaml_frontmatter() -> None:
    body, media_type, filename = export_service.render(ExportFormat.markdown, ITEM, SEGMENTS)
    assert body.startswith("---\n")
    assert body.count("\n---\n") == 1
    assert media_type.startswith("text/markdown")
    assert filename.endswith(".md")


def test_frontmatter_is_flat_yaml_with_expected_keys() -> None:
    body = export_service.render(ExportFormat.markdown, ITEM, SEGMENTS, tags=["climate"], collections=["Reading"])[0]
    frontmatter = body.split("---")[1]
    for key in ("title:", "id:", "source_format:", "triage_status:", "word_count:", "created:", "tags:", "collections:"):
        assert key in frontmatter
    assert "  - climate" in frontmatter


def test_ambiguous_scalars_are_quoted() -> None:
    tricky = {**ITEM, "title": "2024-01-01"}
    body = export_service.render(ExportFormat.markdown, tricky, SEGMENTS)[0]
    assert 'title: "2024-01-01"' in body


def test_segments_render_with_labels_and_scan_placeholder() -> None:
    body = export_service.render(ExportFormat.markdown, ITEM, SEGMENTS)[0]
    assert "## Article" in body
    assert "Household air-conditioning ownership rose." in body
    assert "## Why it matters" in body
    assert "scanned page" in body


def test_summary_is_exported_as_blockquote() -> None:
    body = export_service.render(ExportFormat.markdown, ITEM, SEGMENTS)[0]
    assert "> Peak load overtakes baseload" in body


def test_custom_fields_and_progress_are_preserved() -> None:
    body = export_service.render(ExportFormat.markdown, ITEM, SEGMENTS)[0]
    assert "custom_fields:" in body
    assert "author: A. Researcher" in body
    assert "year: 2024" in body
    assert "verified: true" in body
    assert "reading_progress:" in body
    assert "segment_index: 2" in body


def test_json_export_round_trips() -> None:
    body = export_service.render(ExportFormat.json, ITEM, SEGMENTS)[0]
    payload = json.loads(body)
    assert payload["nexus_export"]["version"] == 1
    assert payload["item"]["title"] == ITEM["title"]
    assert payload["item"]["id"] == str(ITEM_ID)
    assert len(payload["segments"]) == 2
    assert payload["segments"][1]["is_scanned"] is True


def test_bibtex_is_parseable_shape() -> None:
    body = export_service.render(ExportFormat.bibtex, ITEM, SEGMENTS)[0]
    assert body.startswith("@")
    assert body.strip().endswith("}")
    assert "title = {Cooling Demand: 2024 Review}" in body
    assert "author = {A. Researcher}" in body
    assert "year = {2024}" in body
    assert "url = {https://example.org/cooling}" in body


def test_apa_and_mla_contain_author_year_title() -> None:
    apa = export_service.render(ExportFormat.apa, ITEM, SEGMENTS)[0]
    mla = export_service.render(ExportFormat.mla, ITEM, SEGMENTS)[0]
    assert apa.startswith("A. Researcher (2024).")
    assert "Cooling Demand" in apa
    assert mla.startswith('A. Researcher. "Cooling Demand')
    assert mla.endswith(".\n")


def test_citation_fallbacks_do_not_leak_none() -> None:
    bare = {**ITEM, "custom_fields": {}, "metadata": {}, "created_at": None}
    apa = export_service.render(ExportFormat.apa, bare, SEGMENTS)[0]
    bib = export_service.render(ExportFormat.bibtex, bare, SEGMENTS)[0]
    assert "None" not in apa
    assert "None" not in bib
    assert "n.d." in apa


def test_filename_is_sanitised() -> None:
    odd = {**ITEM, "title": "../../etc/passwd"}
    _, _, filename = export_service.render(ExportFormat.markdown, odd, SEGMENTS)
    assert "/" not in filename
    assert ".." not in filename
    assert filename.endswith(".md")


def test_unknown_format_is_rejected() -> None:
    with pytest.raises(ApiError) as excinfo:
        export_service.render("csv", ITEM, SEGMENTS)  # type: ignore[arg-type]
    assert excinfo.value.code == "unsupported_export"


def test_library_zip_has_items_index_and_manifest() -> None:
    payload = export_service.build_library_zip(
        [ITEM],
        {str(ITEM_ID): SEGMENTS},
        tags_by_item={str(ITEM_ID): ["climate"]},
        collections_by_item={str(ITEM_ID): ["Reading"]},
        manifest={"items": 1},
    )
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()
        assert any(name.startswith("items/") and name.endswith(".md") for name in names)
        assert "library.md" in names
        assert "library.json" in names
        assert "README.txt" in names

        markdown = archive.read(next(name for name in names if name.startswith("items/"))).decode()
        assert markdown.startswith("---\n")
        assert "## Article" in markdown

        manifest = json.loads(archive.read("library.json"))
        assert manifest["nexus_backup"]["items"] == 1
        assert manifest["items"][0]["title"] == ITEM["title"]


def test_library_zip_handles_items_without_segments() -> None:
    payload = export_service.build_library_zip([ITEM], {})
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        markdown = archive.read(next(n for n in archive.namelist() if n.startswith("items/"))).decode()
    assert "# Cooling Demand" in markdown


def test_all_five_formats_are_registered() -> None:
    assert set(export_service.RENDERERS) == {
        ExportFormat.markdown,
        ExportFormat.json,
        ExportFormat.bibtex,
        ExportFormat.apa,
        ExportFormat.mla,
    }
