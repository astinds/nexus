"""Extractor contract and registry.

Adding a format means: subclass `BaseExtractor`, implement `supports()` and
`extract()`, then `@register` it. Nothing else in the codebase changes.
See docs/EXTENSION_GUIDE.md for the copy-paste recipe.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar

from ..models.common import ProcessingStatus, SegmentStatus, SourceFormat


class ExtractionError(RuntimeError):
    """A whole document could not be read. Page-level problems never raise."""


@dataclass(slots=True)
class SegmentDraft:
    """One page / section / note body, ready for item_segments."""

    segment_index: int  # 1-based, always
    segment_label: str
    content: str = ""
    is_scanned: bool = False
    extraction_status: SegmentStatus = SegmentStatus.ok
    metadata: dict[str, Any] = field(default_factory=dict)

    def as_row(self) -> dict[str, Any]:
        return {
            "segment_index": self.segment_index,
            "segment_label": self.segment_label,
            "content": self.content,
            "is_scanned": self.is_scanned,
            "extraction_status": self.extraction_status.value
            if isinstance(self.extraction_status, SegmentStatus)
            else str(self.extraction_status),
            "metadata": self.metadata,
        }


@dataclass(slots=True)
class ExtractionResult:
    """Outcome of one document. Partial success is a first-class state."""

    segments: list[SegmentDraft]
    engine: str
    title: str | None = None
    status: ProcessingStatus = ProcessingStatus.ready
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    # Raw bytes kept for link-rot protection (web clips). IngestService stores
    # this as items.snapshot_uri; it is never written into a JSON column.
    archival: bytes | None = None

    @property
    def word_count(self) -> int:
        from ..text import count_words

        return sum(count_words(segment.content) for segment in self.segments)

    @property
    def scanned_segments(self) -> list[SegmentDraft]:
        return [segment for segment in self.segments if segment.is_scanned]

    @property
    def failed_segments(self) -> list[SegmentDraft]:
        return [
            segment
            for segment in self.segments
            if str(segment.extraction_status).endswith(SegmentStatus.failed.value)
        ]

    def integrity_summary(self) -> dict[str, Any]:
        """The banner data the inspector shows. Never hides a bad page."""
        return {
            "segments": len(self.segments),
            "pages": len(self.segments),
            "extracted": sum(
                1
                for s in self.segments
                if str(s.extraction_status).endswith(SegmentStatus.ok.value)
            ),
            "scanned": len(self.scanned_segments),
            "empty": sum(
                1
                for s in self.segments
                if str(s.extraction_status).endswith(SegmentStatus.empty.value)
            ),
            "failed": len(self.failed_segments),
            "partial": bool(self.scanned_segments or self.failed_segments),
            "scanned_labels": [s.segment_label for s in self.scanned_segments],
            "failed_labels": [s.segment_label for s in self.failed_segments],
            "engine": self.engine,
        }


class BaseExtractor(ABC):
    """All extractors receive bytes (or text) and return segments."""

    name: ClassVar[str] = "base"
    formats: ClassVar[tuple[SourceFormat, ...]] = ()
    mime_types: ClassVar[tuple[str, ...]] = ()
    extensions: ClassVar[tuple[str, ...]] = ()

    @classmethod
    def supports(
        cls,
        *,
        source_format: SourceFormat | None = None,
        mime_type: str | None = None,
        filename: str | None = None,
    ) -> bool:
        if source_format is not None and source_format in cls.formats:
            return True
        if mime_type and mime_type in cls.mime_types:
            return True
        if filename:
            lowered = filename.lower()
            if any(lowered.endswith(ext) for ext in cls.extensions):
                return True
        return False

    @abstractmethod
    def extract(
        self,
        *,
        data: bytes | None = None,
        text: str | None = None,
        filename: str | None = None,
        mime_type: str | None = None,
        hints: dict[str, Any] | None = None,
    ) -> ExtractionResult:
        """Extract segments. Raise ExtractionError only when nothing is usable."""


class ExtractorRegistry:
    """Ordered registry: the first extractor that supports a request wins."""

    def __init__(self) -> None:
        self._extractors: list[BaseExtractor] = []

    def register(self, extractor: BaseExtractor) -> BaseExtractor:
        self._extractors.append(extractor)
        return extractor

    def all(self) -> list[BaseExtractor]:
        return list(self._extractors)

    def resolve(
        self,
        *,
        source_format: SourceFormat | None,
        mime_type: str | None,
        filename: str | None,
    ) -> BaseExtractor:
        for extractor in self._extractors:
            if extractor.supports(
                source_format=source_format, mime_type=mime_type, filename=filename
            ):
                return extractor
        raise ExtractionError(
            "no extractor handles this file type "
            f"(format={source_format}, mime={mime_type}, filename={filename})"
        )
