"""Pydantic contract tests: the schema is the API contract, so pin it down."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import (
    BlueprintCreate,
    BlueprintFieldSpec,
    BlueprintFieldsSchema,
    IngestTextRequest,
    IngestUrlRequest,
    LibraryFilters,
    PreferencesUpdate,
    ProgressUpdate,
    SourceFormat,
    TagMergeRequest,
    TriageStatus,
    clamp_limit,
    clamp_offset,
)


def test_blueprint_field_key_is_normalised_to_snake_case() -> None:
    field = BlueprintFieldSpec(key="Publication Year", label="Year", type="number")
    assert field.key == "publication_year"


def test_blueprint_field_rejects_invalid_key() -> None:
    with pytest.raises(ValidationError):
        BlueprintFieldSpec(key="1bad", label="Bad")


def test_select_field_requires_options() -> None:
    with pytest.raises(ValidationError):
        BlueprintFieldSpec(key="status", label="Status", type="select")
    ok = BlueprintFieldSpec(key="status", label="Status", type="select", options=["draft"])
    assert ok.options == ["draft"]


def test_blueprint_schema_rejects_duplicate_keys() -> None:
    with pytest.raises(ValidationError):
        BlueprintFieldsSchema(
            fields=[
                BlueprintFieldSpec(key="author", label="Author"),
                BlueprintFieldSpec(key="author", label="Author 2"),
            ]
        )


def test_blueprint_create_serialises_formats_to_strings() -> None:
    blueprint = BlueprintCreate(
        name="Research Paper",
        default_formats=[SourceFormat.pdf, SourceFormat.docx],
        fields_schema=BlueprintFieldsSchema(
            fields=[BlueprintFieldSpec(key="doi", label="DOI", type="text")]
        ),
    )
    dumped = blueprint.model_dump(mode="json")
    assert dumped["default_formats"] == ["pdf", "docx"]
    assert dumped["fields_schema"]["fields"][0]["key"] == "doi"


def test_ingest_text_defaults_to_note_and_inbox() -> None:
    payload = IngestTextRequest(text="hello")
    assert payload.source_format is SourceFormat.markdown
    assert payload.triage_status is TriageStatus.inbox
    assert payload.tags == []


def test_ingest_url_rejects_non_http_scheme() -> None:
    with pytest.raises(ValidationError):
        IngestUrlRequest(url="file:///etc/passwd")
    assert IngestUrlRequest(url="https://example.com/a").url.endswith("/a")


def test_progress_update_requires_a_signal() -> None:
    with pytest.raises(ValidationError):
        ProgressUpdate()
    assert ProgressUpdate(segment_index=4).segment_index == 4
    assert ProgressUpdate(percent=12.5).percent == 12.5


def test_progress_percent_is_bounded() -> None:
    with pytest.raises(ValidationError):
        ProgressUpdate(percent=101)


def test_tag_merge_rejects_identical_ids() -> None:
    shared = "11111111-1111-1111-1111-111111111111"
    with pytest.raises(ValidationError):
        TagMergeRequest(source_tag_id=shared, target_tag_id=shared)


def test_library_filters_pagination_clamps() -> None:
    assert clamp_limit(0) == 50
    assert clamp_limit(10_000) == 200
    assert clamp_offset(-5) == 0
    assert LibraryFilters().sort == "recent"


def test_preferences_payload_accepts_arbitrary_tokens() -> None:
    payload = PreferencesUpdate(payload={"font_scale": 1.15, "accent": "#8ab4f8"})
    assert payload.payload["font_scale"] == 1.15


def test_models_forbid_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        IngestTextRequest(text="hi", unexpected="nope")
