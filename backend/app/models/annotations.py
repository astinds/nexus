"""Annotation models: what the reader sends and what it gets back."""

from __future__ import annotations

from datetime import datetime
from typing import Self
from uuid import UUID

from pydantic import Field, model_validator

from .common import NexusModel


class AnnotationCreate(NexusModel):
    """A note and/or a quote anchored to a page (or to the whole item)."""

    segment_index: int | None = Field(default=None, ge=1)
    segment_label: str | None = Field(default=None, max_length=200)
    quote_text: str | None = Field(default=None, max_length=4000)
    note_body: str = Field(default="", max_length=20000)
    color: str = Field(default="default", max_length=16)

    @model_validator(mode="after")
    def _something_to_say(self) -> Self:
        # Mirrors the `annotations_content_present` CHECK so the client gets a
        # 422 with a readable message instead of a constraint violation.
        if not (self.note_body or "").strip() and not (self.quote_text or "").strip():
            raise ValueError("an annotation needs note_body or quote_text")
        return self


class AnnotationUpdate(NexusModel):
    """Partial update; omitted fields are left untouched."""

    segment_index: int | None = Field(default=None, ge=1)
    segment_label: str | None = Field(default=None, max_length=200)
    quote_text: str | None = Field(default=None, max_length=4000)
    note_body: str | None = Field(default=None, max_length=20000)
    color: str | None = Field(default=None, max_length=16)


class Annotation(NexusModel):
    id: UUID
    item_id: UUID
    segment_index: int | None = None
    segment_label: str | None = None
    quote_text: str | None = None
    note_body: str = ""
    color: str = "default"
    created_at: datetime
    updated_at: datetime
