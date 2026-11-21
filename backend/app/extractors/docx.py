"""DOCX extraction via python-docx: one segment per heading section.

Word documents have no pages, so sections are the honest unit: each heading starts a
segment, and every table inside a section is appended as pipe-separated rows so the
content is still searchable.
"""

from __future__ import annotations

import io
from typing import Any

from ..models.common import ProcessingStatus, SegmentStatus, SourceFormat
from ..text import humanize_title
from .base import BaseExtractor, ExtractionError, ExtractionResult, SegmentDraft

HEADING_STYLES = {
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Heading 4",
    "Heading 5",
    "Heading 6",
    "Title",
    "Subtitle",
}


class DocxExtractor(BaseExtractor):
    name = "docx"
    formats = (SourceFormat.docx,)
    mime_types = ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",)
    extensions = (".docx",)

    def extract(
        self,
        *,
        data: bytes | None = None,
        text: str | None = None,
        filename: str | None = None,
        mime_type: str | None = None,
        hints: dict[str, Any] | None = None,
    ) -> ExtractionResult:
        if not data:
            raise ExtractionError("DOCX extraction needs the file bytes")
        try:
            import docx  # noqa: PLC0415
        except ImportError as exc:
            raise ImportError(f"python-docx is not installed ({exc})") from exc

        try:
            document = docx.Document(io.BytesIO(data))
        except Exception as exc:
            raise ExtractionError(f"not a readable .docx file: {type(exc).__name__}: {exc}")

        sections: list[tuple[str, list[str]]] = [("Document", [])]
        for paragraph in document.paragraphs:
            body = (paragraph.text or "").strip()
            style = (getattr(paragraph.style, "name", "") or "").strip()
            if style in HEADING_STYLES and body:
                sections.append((body, []))
                continue
            if body:
                sections[-1][1].append(body)

        for position, table in enumerate(document.tables, start=1):
            rows: list[str] = []
            for row in table.rows:
                cells = [cell.text.strip().replace("\n", " ") for cell in row.cells]
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                sections.append((f"Table {position}", rows))

        # A document that opens with a heading leaves the synthetic first section
        # empty; drop it rather than reporting a phantom empty segment.
        if sections[0][0] == "Document" and not sections[0][1]:
            sections = sections[1:] or [("Document", [])]

        segments: list[SegmentDraft] = []
        for index, (label, lines) in enumerate(sections, start=1):
            content = "\n".join(lines).strip()
            segments.append(
                SegmentDraft(
                    segment_index=index,
                    segment_label=label[:200] if label != "Document" else "Body",
                    content=content,
                    extraction_status=SegmentStatus.ok if content else SegmentStatus.empty,
                    metadata={"chars": len(content)},
                )
            )

        warnings: list[str] = []
        if all(segment.extraction_status is SegmentStatus.empty for segment in segments):
            warnings.append("Every section is empty; the document may contain only images.")
        status = (
            ProcessingStatus.ready
            if all(segment.extraction_status is SegmentStatus.ok for segment in segments)
            else ProcessingStatus.partial
        )
        return ExtractionResult(
            segments=segments,
            engine="python-docx",
            title=humanize_title(filename) if filename else None,
            status=status,
            warnings=warnings,
            metadata={"sections": len(segments), "tables": len(document.tables)},
        )
