"""Item, segment, link, ingest, search and dashboard models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from .common import (
    NexusModel,
    ProcessingStatus,
    SegmentStatus,
    SourceFormat,
    TimeBudget,
    TriageStatus,
)
from .library import ActivityLog, Collection, Tag  # noqa: F401  (re-export)


# ------------------------------------------------------------------------- segments
class SegmentCreate(NexusModel):
    segment_index: int = Field(ge=1)
    segment_label: str = Field(min_length=1, max_length=200)
    content: str = ""
    is_scanned: bool = False
    extraction_status: SegmentStatus = SegmentStatus.ok
    metadata: dict[str, Any] = Field(default_factory=dict)


class Segment(NexusModel):
    id: UUID
    item_id: UUID
    segment_index: int
    segment_label: str
    content: str = ""
    is_scanned: bool = False
    extraction_status: str = "ok"
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class SegmentIntegrity(NexusModel):
    """Honest extraction audit shown in the inspector banner."""

    segments: int = 0
    pages: int = 0
    extracted: int = 0
    scanned: int = 0
    empty: int = 0
    failed: int = 0
    partial: bool = False
    scanned_labels: list[str] = Field(default_factory=list)
    failed_labels: list[str] = Field(default_factory=list)
    engine: str | None = None


# ---------------------------------------------------------------------------- items
class ItemCreate(NexusModel):
    """Zero mandatory fields: capture first, decide later."""

    title: str | None = Field(default=None, max_length=500)
    source_format: SourceFormat = SourceFormat.note
    workspace_id: UUID | None = None
    blueprint_id: UUID | None = None
    source_uri: str | None = Field(default=None, max_length=2000)
    mime_type: str | None = Field(default=None, max_length=200)
    content: str | None = None
    triage_status: TriageStatus = TriageStatus.inbox
    custom_fields: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list, max_length=50)
    collection_ids: list[UUID] = Field(default_factory=list, max_length=50)


class ItemUpdate(NexusModel):
    """Partial update. Omitted fields are untouched; explicit null clears nullable ones."""

    title: str | None = Field(default=None, min_length=1, max_length=500)
    blueprint_id: UUID | None = None
    triage_status: TriageStatus | None = None
    summary: str | None = Field(default=None, max_length=6000)
    custom_fields: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None

    @model_validator(mode="before")
    @classmethod
    def _reject_null_for_required(cls, data: Any) -> Any:
        # `title` is NOT NULL in PostgreSQL: a null must fail as 422 here rather
        # than reaching the database or being silently ignored.
        if isinstance(data, dict) and "title" in data and data["title"] is None:
            raise ValueError("title cannot be null; omit it to keep the current title")
        return data


class TriageUpdate(NexusModel):
    triage_status: TriageStatus


class ProgressUpdate(NexusModel):
    segment_index: int | None = Field(default=None, ge=1)
    segment_label: str | None = Field(default=None, max_length=200)
    percent: float | None = Field(default=None, ge=0, le=100)
    location: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _something(self) -> "ProgressUpdate":
        if self.segment_index is None and self.percent is None and self.location is None:
            raise ValueError("provide segment_index, percent or location")
        return self


class Item(NexusModel):
    id: UUID
    workspace_id: UUID
    blueprint_id: UUID | None = None
    title: str
    source_format: str
    source_uri: str | None = None
    snapshot_uri: str | None = None
    mime_type: str | None = None
    file_size: int | None = None
    word_count: int = 0
    est_read_minutes: int = 0
    content_hash: str | None = None
    processing_status: str = ProcessingStatus.pending.value
    triage_status: str = TriageStatus.inbox.value
    reading_progress: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None
    summary: str | None = None
    custom_fields: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ItemLinkView(NexusModel):
    id: UUID
    source_item_id: UUID
    target_item_id: UUID
    relation_type_id: UUID
    relation_name: str | None = None
    source_segment_id: UUID | None = None
    note: str | None = None
    created_at: datetime
    direction: Literal["outgoing", "incoming"] = "outgoing"
    other_item_id: UUID | None = None
    other_title: str | None = None
    other_format: str | None = None


class ItemLinkCreate(NexusModel):
    target_item_id: UUID
    relation_type_id: UUID
    source_segment_id: UUID | None = None
    note: str | None = Field(default=None, max_length=2000)


class ItemDetail(Item):
    """Item plus everything the inspector drawer needs in one round trip."""

    tags: list[Tag] = Field(default_factory=list)
    collections: list[Collection] = Field(default_factory=list)
    segments: list[Segment] | None = None
    links: list[ItemLinkView] = Field(default_factory=list)
    integrity: SegmentIntegrity | None = None
    blueprint_fields: list[dict[str, Any]] = Field(default_factory=list)


class NoteContentUpdate(NexusModel):
    """Inline Markdown edit of a note; triggers re-indexing of its segments."""

    content: str


# ------------------------------------------------------------------------- ingest
class IngestTextRequest(NexusModel):
    text: str = Field(min_length=1)
    title: str | None = Field(default=None, max_length=500)
    source_format: SourceFormat = SourceFormat.markdown
    workspace_id: UUID | None = None
    blueprint_id: UUID | None = None
    source_uri: str | None = Field(default=None, max_length=2000)
    triage_status: TriageStatus = TriageStatus.inbox
    tags: list[str] = Field(default_factory=list, max_length=50)
    collection_ids: list[UUID] = Field(default_factory=list, max_length=50)
    is_paste_fallback: bool = False


class IngestUrlRequest(NexusModel):
    url: str = Field(min_length=4, max_length=2000)
    title: str | None = Field(default=None, max_length=500)
    workspace_id: UUID | None = None
    blueprint_id: UUID | None = None
    triage_status: TriageStatus = TriageStatus.inbox
    tags: list[str] = Field(default_factory=list, max_length=50)
    collection_ids: list[UUID] = Field(default_factory=list, max_length=50)

    @field_validator("url")
    @classmethod
    def _http_only(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned.startswith(("http://", "https://")):
            raise ValueError("url must start with http:// or https://")
        return cleaned


class IngestResult(NexusModel):
    item: Item
    duplicate: bool = False
    segments_created: int = 0
    warnings: list[str] = Field(default_factory=list)
    engine: str | None = None
    integrity: SegmentIntegrity | None = None


# --------------------------------------------------------------------------- search
class SearchHit(NexusModel):
    item_id: UUID
    title: str
    source_format: str
    triage_status: str
    est_read_minutes: int = 0
    segment_id: UUID | None = None
    segment_index: int | None = None
    segment_label: str | None = None
    snippet: str = ""
    rank: float = 0.0


class SearchResponse(NexusModel):
    query: str
    mode: Literal["fulltext", "fallback"] = "fulltext"
    hits: list[SearchHit] = Field(default_factory=list)
    total: int = 0
    limit: int = 0
    offset: int = 0
    facets: dict[str, dict[str, int]] = Field(default_factory=dict)


# ------------------------------------------------------------------------ dashboard
class LibraryFilters(NexusModel):
    workspace_id: UUID | None = None
    source_format: SourceFormat | None = None
    blueprint_id: UUID | None = None
    triage_status: TriageStatus | None = None
    collection_id: UUID | None = None
    tag: str | None = None
    time_budget: TimeBudget | None = None
    q: str | None = None
    sort: Literal["recent", "created", "title", "reading_time", "word_count"] = "recent"
    limit: int = 50
    offset: int = 0


class DashboardStats(NexusModel):
    totals: dict[str, int] = Field(default_factory=dict)
    by_format: dict[str, int] = Field(default_factory=dict)
    by_blueprint: dict[str, int] = Field(default_factory=dict)
    by_triage: dict[str, int] = Field(default_factory=dict)
    scanned_segments: int = 0
    failed_extractions: int = 0
    continue_reading: list[Item] = Field(default_factory=list)
    recently_added: list[Item] = Field(default_factory=list)
    recent_activity: list[ActivityLog] = Field(default_factory=list)
