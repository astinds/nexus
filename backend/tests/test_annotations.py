"""Annotation contract: page anchoring, quote preservation, honest 422s.

The repository runs no SQL here (there is no local PostgreSQL), so these tests pin
what actually breaks in production: the model refusing an empty annotation, the
optional page anchor, and the migration's CHECK constraint agreeing with it.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models.annotations import AnnotationCreate, AnnotationUpdate

MIGRATIONS = Path(__file__).parent.parent.parent / "supabase" / "migrations"


def test_a_note_needs_a_body_or_a_quote() -> None:
    with pytest.raises(ValidationError):
        AnnotationCreate(note_body="   ", quote_text="")


def test_quote_only_is_valid() -> None:
    annotation = AnnotationCreate(quote_text="the sentence they highlighted")
    assert annotation.note_body == ""
    assert annotation.color == "default"


def test_note_only_is_valid_and_page_optional() -> None:
    annotation = AnnotationCreate(note_body="remember this claim", segment_index=93)
    assert annotation.segment_index == 93
    item_wide = AnnotationCreate(note_body="about the whole book")
    assert item_wide.segment_index is None


def test_page_numbers_are_one_based() -> None:
    with pytest.raises(ValidationError):
        AnnotationCreate(note_body="x", segment_index=0)


def test_null_segment_index_means_item_wide_not_page_zero() -> None:
    annotation = AnnotationCreate(note_body="x", segment_index=None)
    assert annotation.segment_index is None


def test_update_leaves_omitted_fields_untouched() -> None:
    payload = AnnotationUpdate(note_body="edited")
    assert payload.model_dump(exclude_unset=True) == {"note_body": "edited"}


def test_migration_declares_annotations_table_and_indexes() -> None:
    sql = (MIGRATIONS / "004_annotations.sql").read_text(encoding="utf-8").lower()
    assert "create table if not exists annotations" in sql
    for column in ("item_id", "segment_index", "quote_text", "note_body", "created_at", "updated_at"):
        assert column in sql, f"annotations missing column {column}"
    assert "references items(id) on delete cascade" in sql
    assert "annotations_item_idx" in sql
    assert "annotations_item_created_idx" in sql


def test_migration_check_matches_the_model_rule() -> None:
    """The DB constraint and the 422 must not disagree about 'empty'."""
    sql = (MIGRATIONS / "004_annotations.sql").read_text(encoding="utf-8").lower()
    assert "annotations_content_present" in sql
    assert "note_body" in sql and "quote_text" in sql
    assert "btrim" in sql


def test_annotation_serialises_round_trip_shape() -> None:
    from app.models.annotations import Annotation

    model = Annotation(
        id=uuid4(),
        item_id=uuid4(),
        segment_index=14,
        segment_label="Page 14",
        quote_text=None,
        note_body="hi",
        color="default",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    payload = model.model_dump(mode="json")
    assert set(payload) >= {"id", "item_id", "segment_index", "note_body", "created_at"}
