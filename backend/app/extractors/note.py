"""Native note extractor: built-in Markdown notes and pasted snippets.

Kept separate from the document extractors because notes are edited in place and
re-indexed on save, which is a different lifecycle from an uploaded file.
"""

from __future__ import annotations

from typing import Any

from ..models.common import ProcessingStatus, SegmentStatus, SourceFormat
from ..text import humanize_title, split_markdown_sections
from .base import BaseExtractor, ExtractionResult, SegmentDraft
from .text import decode_text


class NativeNoteExtractor(BaseExtractor):
    """Notes index one segment per heading section, re-runnable at any time."""

    name = "native_note"
    formats = (SourceFormat.note, SourceFormat.markdown)
    mime_types = ("text/markdown",)
    extensions = ()

    def extract(
        self,
        *,
        data: bytes | None = None,
        text: str | None = None,
        filename: str | None = None,
        mime_type: str | None = None,
        hints: dict[str, Any] | None = None,
    ) -> ExtractionResult:
        body = decode_text(data, text)
        sections = split_markdown_sections(body)
        segments: list[SegmentDraft] = []
        for position, (label, content) in enumerate(sections, start=1):
            resolved = "Note Body" if label == "Body" else label
            segments.append(
                SegmentDraft(
                    segment_index=position,
                    segment_label=resolved[:200],
                    content=content,
                    extraction_status=SegmentStatus.ok if content.strip() else SegmentStatus.empty,
                    metadata={"chars": len(content)},
                )
            )
        if not segments:
            segments = [
                SegmentDraft(
                    segment_index=1,
                    segment_label="Note Body",
                    content="",
                    extraction_status=SegmentStatus.empty,
                )
            ]
        warnings = [] if body.strip() else ["The note is empty; nothing was indexed."]
        return ExtractionResult(
            segments=segments,
            engine="native-note",
            title=humanize_title(filename) if filename else None,
            status=ProcessingStatus.ready if body.strip() else ProcessingStatus.needs_enrichment,
            warnings=warnings,
            metadata={"chars": len(body)},
        )
