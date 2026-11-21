"""Extractor registry instance.

Stage 3 registers the pure-Python extractors. Stage 4 adds PdfExtractor,
DocxExtractor and WebArticleExtractor here; nothing else needs to change.
"""

from __future__ import annotations

from ..models.common import SourceFormat
from .base import (
    BaseExtractor,
    ExtractionError,
    ExtractionResult,
    ExtractorRegistry,
    SegmentDraft,
)
from .note import NativeNoteExtractor
from .text import TextStructuredExtractor

registry = ExtractorRegistry()

# Order matters: the more specific extractor is registered first.
registry.register(NativeNoteExtractor())
registry.register(TextStructuredExtractor())


def register(extractor: BaseExtractor) -> BaseExtractor:
    return registry.register(extractor)


def resolve(
    *,
    source_format: SourceFormat | None = None,
    mime_type: str | None = None,
    filename: str | None = None,
) -> BaseExtractor:
    return registry.resolve(
        source_format=source_format, mime_type=mime_type, filename=filename
    )


def available() -> list[dict[str, object]]:
    """Health / Settings payload: which formats this deployment can ingest."""
    rows: list[dict[str, object]] = []
    for extractor in registry.all():
        rows.append(
            {
                "name": extractor.name,
                "formats": [fmt.value for fmt in extractor.formats],
                "extensions": list(extractor.extensions),
            }
        )
    return rows


__all__ = [
    "BaseExtractor",
    "ExtractionError",
    "ExtractionResult",
    "SegmentDraft",
    "available",
    "register",
    "registry",
    "resolve",
]
