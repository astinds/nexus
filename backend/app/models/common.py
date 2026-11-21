"""Shared enums, base models and pagination helpers."""

from __future__ import annotations

from enum import StrEnum
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from ..text import read_minutes  # single definition lives in app/text.py; re-exported

__all__ = ["read_minutes"]

T = TypeVar("T")

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class SourceFormat(StrEnum):
    """The immutable container. Never confuses with a blueprint."""

    pdf = "pdf"
    docx = "docx"
    markdown = "markdown"
    text = "text"
    csv = "csv"
    json = "json"
    web_article = "web_article"
    note = "note"


class ProcessingStatus(StrEnum):
    pending = "pending"
    processing = "processing"
    ready = "ready"
    partial = "partial"
    needs_enrichment = "needs_enrichment"
    failed = "failed"


class TriageStatus(StrEnum):
    inbox = "inbox"
    reading = "reading"
    processed = "processed"
    evergreen = "evergreen"
    cold_archive = "cold_archive"


class SegmentStatus(StrEnum):
    ok = "ok"
    empty = "empty"
    scanned = "scanned"
    failed = "failed"
    skipped = "skipped"


class ParaType(StrEnum):
    project = "project"
    area = "area"
    resource = "resource"
    archive = "archive"


class SavedViewKind(StrEnum):
    library = "library"
    search = "search"


class ExportFormat(StrEnum):
    markdown = "markdown"
    json = "json"
    bibtex = "bibtex"
    apa = "apa"
    mla = "mla"


class TimeBudget(StrEnum):
    """Time-Budget filter buckets used by the Library smart lens."""

    quick = "quick"  # < 5 minutes
    medium = "medium"  # 15-30 minutes
    deep = "deep"  # > 30 minutes


class NexusModel(BaseModel):
    """Base for request/response models."""

    model_config = ConfigDict(from_attributes=True, extra="forbid", populate_by_name=True)


class Page(BaseModel, Generic[T]):
    items: list[T] = Field(default_factory=list)
    total: int = 0
    limit: int = DEFAULT_LIMIT
    offset: int = 0


def clamp_limit(limit: int | None, default: int = DEFAULT_LIMIT) -> int:
    if not limit or limit < 1:
        return default
    return min(int(limit), MAX_LIMIT)


def clamp_offset(offset: int | None) -> int:
    return max(0, int(offset or 0))
