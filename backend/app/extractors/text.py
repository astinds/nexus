"""Pure-Python extractors: Markdown, plain text, HTML, CSV, JSON and native notes.

No native dependencies, so these are the most reliable path in any environment.
HTML goes through BeautifulSoup when available, with a stdlib HTMLParser fallback.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from ..models.common import ProcessingStatus, SegmentStatus, SourceFormat
from ..text import humanize_title, split_markdown_sections, truncate
from .base import BaseExtractor, ExtractionResult, SegmentDraft

MAX_SEGMENT_CHARS = 12000


def _html_to_text(markup: str) -> str:
    """BeautifulSoup when installed, otherwise a small stdlib reader."""
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(markup, "html.parser")
        for tag in soup(["script", "style", "noscript", "template"]):
            tag.decompose()
        text = soup.get_text("\n")
    except Exception:
        from html.parser import HTMLParser

        class _Reader(HTMLParser):
            def __init__(self) -> None:
                super().__init__()
                self.parts: list[str] = []
                self._skip = False

            def handle_starttag(self, tag: str, attrs: Any) -> None:
                if tag in {"script", "style"}:
                    self._skip = True

            def handle_endtag(self, tag: str) -> None:
                if tag in {"script", "style"}:
                    self._skip = False

            def handle_data(self, data: str) -> None:
                if not self._skip:
                    self.parts.append(data)

        reader = _Reader()
        reader.feed(markup)
        text = "\n".join(reader.parts)

    lines = [line.strip() for line in text.splitlines()]
    compact: list[str] = []
    for line in lines:
        if line or (compact and compact[-1]):
            compact.append(line)
    return "\n".join(compact).strip()


def decode_text(data: bytes | None, text: str | None) -> str:
    if text is not None:
        return text
    if data is None:
        return ""
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _segments_from_markdown(body: str, *, label_prefix: str = "Section") -> list[SegmentDraft]:
    """One segment per heading section, each capped at MAX_SEGMENT_CHARS.

    Labels come from the document's own headings. Text before the first heading
    is labelled "Preamble", and a document with no headings yields "Note Body".
    """
    sections = split_markdown_sections(body)
    segments: list[SegmentDraft] = []
    index = 1
    no_headings = len(sections) == 1 and sections[0][0] == "Body"
    for position, (label, content) in enumerate(sections, start=1):
        resolved_label = "Note Body" if no_headings else ("Preamble" if label == "Body" else label)
        chunk = content
        continuation = 0
        while True:
            piece = chunk[:MAX_SEGMENT_CHARS]
            chunk = chunk[MAX_SEGMENT_CHARS:]
            segment_label = resolved_label if continuation == 0 else f"{resolved_label} (cont. {continuation})"
            segments.append(
                SegmentDraft(
                    segment_index=index,
                    segment_label=segment_label[:200],
                    content=piece,
                    extraction_status=SegmentStatus.ok if piece.strip() else SegmentStatus.empty,
                    metadata={"chars": len(piece), "section": position},
                )
            )
            index += 1
            continuation += 1
            if not chunk:
                break
    if not segments:
        segments.append(
            SegmentDraft(
                segment_index=1,
                segment_label="Note Body",
                content="",
                extraction_status=SegmentStatus.empty,
            )
        )
    return segments


class TextStructuredExtractor(BaseExtractor):
    """`.md`, `.txt`, `.html`, `.csv`, `.json` — pure Python."""

    name = "text_structured"
    formats = (
        SourceFormat.markdown,
        SourceFormat.text,
        SourceFormat.csv,
        SourceFormat.json,
    )
    mime_types = (
        "text/markdown",
        "text/plain",
        "text/csv",
        "application/json",
        "text/html",
    )
    extensions = (".md", ".markdown", ".txt", ".text", ".csv", ".json", ".html", ".htm")

    def extract(
        self,
        *,
        data: bytes | None = None,
        text: str | None = None,
        filename: str | None = None,
        mime_type: str | None = None,
        hints: dict[str, Any] | None = None,
    ) -> ExtractionResult:
        raw = decode_text(data, text)
        lowered = (filename or "").lower()
        mime = (mime_type or "").lower()
        warnings: list[str] = []

        if lowered.endswith((".html", ".htm")) or mime == "text/html":
            body = _html_to_text(raw)
            segments = _segments_from_markdown(body)
            engine = "html-beautifulsoup"
        elif lowered.endswith(".csv") or mime == "text/csv":
            segments = self._csv_segments(raw)
            engine = "csv-stdlib"
        elif lowered.endswith(".json") or mime == "application/json":
            segments, warnings = self._json_segments(raw)
            engine = "json-stdlib"
        else:
            segments = _segments_from_markdown(raw)
            engine = "markdown-sections" if lowered.endswith((".md", ".markdown")) else "text-chunks"

        status = (
            ProcessingStatus.partial
            if any(s.extraction_status == SegmentStatus.empty for s in segments)
            else ProcessingStatus.ready
        )
        if not raw.strip():
            warnings.append("The document is empty; no text could be indexed.")

        return ExtractionResult(
            segments=segments,
            engine=engine,
            title=humanize_title(filename) if filename else None,
            status=status if segments else ProcessingStatus.failed,
            warnings=warnings,
            metadata={"chars": len(raw)},
        )

    @staticmethod
    def _csv_segments(raw: str) -> list[SegmentDraft]:
        reader = csv.reader(io.StringIO(raw))
        rows = list(reader)
        if not rows:
            return [
                SegmentDraft(
                    segment_index=1,
                    segment_label="Row 1",
                    content="",
                    extraction_status=SegmentStatus.empty,
                )
            ]
        header, *body = rows
        segments: list[SegmentDraft] = []
        # Header becomes its own segment so column names are searchable once,
        # then every row is a segment with "col: value" lines for clean snippets.
        segments.append(
            SegmentDraft(
                segment_index=1,
                segment_label="Header",
                content=" | ".join(header),
                metadata={"columns": header},
            )
        )
        for position, row in enumerate(body, start=1):
            pairs = [f"{name.strip()}: {value}" for name, value in zip(header, row) if value.strip()]
            segments.append(
                SegmentDraft(
                    segment_index=position + 1,
                    segment_label=f"Row {position}",
                    content="\n".join(pairs) or " | ".join(row),
                    metadata={"row": position},
                )
            )
        return segments

    @staticmethod
    def _json_segments(raw: str) -> tuple[list[SegmentDraft], list[str]]:
        warnings: list[str] = []
        try:
            parsed = json.loads(raw) if raw.strip() else None
        except json.JSONDecodeError as exc:
            warnings.append(f"Invalid JSON ({exc.msg} at line {exc.lineno}); treated as plain text.")
            return _segments_from_markdown(raw), warnings

        pretty = json.dumps(parsed, indent=2, ensure_ascii=False)
        if isinstance(parsed, list):
            segments = []
            for position, entry in enumerate(parsed, start=1):
                segments.append(
                    SegmentDraft(
                        segment_index=position,
                        segment_label=f"Item {position}",
                        content=truncate(json.dumps(entry, indent=2, ensure_ascii=False), 20000),
                        metadata={"index": position},
                    )
                )
        elif isinstance(parsed, dict):
            segments = []
            for position, (key, value) in enumerate(parsed.items(), start=1):
                segments.append(
                    SegmentDraft(
                        segment_index=position,
                        segment_label=str(key)[:120] or f"Key {position}",
                        content=truncate(json.dumps(value, indent=2, ensure_ascii=False), 20000),
                        metadata={"key": str(key)},
                    )
                )
        else:
            segments = [
                SegmentDraft(segment_index=1, segment_label="Value", content=pretty)
            ]
        return segments or [
            SegmentDraft(segment_index=1, segment_label="Document", content=pretty)
        ], warnings
