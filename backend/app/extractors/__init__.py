"""Extractor registry instance.

Registration order matters: the first extractor whose `supports()` matches wins, so
specific formats come before the generic text handlers.
"""

from __future__ import annotations

import os
import re

from ..models.common import SourceFormat
from .base import (
    BaseExtractor,
    ExtractionError,
    ExtractionResult,
    ExtractorRegistry,
    SegmentDraft,
)
from .docx import DocxExtractor
from .note import NativeNoteExtractor
from .pdf import PdfExtractor
from .text import TextStructuredExtractor
from .web import WebArticleExtractor

registry = ExtractorRegistry()

registry.register(PdfExtractor())
registry.register(DocxExtractor())
registry.register(WebArticleExtractor())
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
    return [
        {
            "name": extractor.name,
            "formats": [fmt.value for fmt in extractor.formats],
            "extensions": list(extractor.extensions),
        }
        for extractor in registry.all()
    ]


# Optional engines, with the role each one plays. Reported independently so one
# missing native library never hides the status of the others.
OPTIONAL_ENGINES: tuple[tuple[str, str, str], ...] = (
    ("pymupdf", "pymupdf", "primary PDF engine (1-based pages, image-only page detection)"),
    ("pypdf", "pypdf", "pure-Python PDF fallback engine"),
    ("python-docx", "docx", "DOCX extraction"),
    ("trafilatura", "trafilatura", "web article boilerplate removal"),
    ("beautifulsoup4", "bs4", "HTML parsing and web article fallback"),
)

_SYMBOL_RE = re.compile(r'cannot locate symbol "([^"]+)" referenced by "([^"]+)"')


def _short_reason(exc: BaseException) -> str:
    """A one-line reason a probe failed, safe to show in the Settings page."""
    text = " ".join(str(exc).split())
    match = _SYMBOL_RE.search(text)
    if match:
        symbol, library = match.group(1), os.path.basename(match.group(2))
        return (
            f"native library mismatch: {library} needs missing symbol {symbol} "
            "(works on the deploy host, not on this device)"
        )
    if not text:
        return type(exc).__name__
    return text[:200]


def engine_status() -> list[dict[str, object]]:
    """Honest per-engine availability report used by /api/v1/health."""
    rows: list[dict[str, object]] = []
    for label, module, role in OPTIONAL_ENGINES:
        try:
            __import__(module)
        except Exception as exc:  # noqa: BLE001 - any import failure is a finding
            detail = f"unavailable: {_short_reason(exc)}"
            available_flag = False
        else:
            detail = role
            available_flag = True
        rows.append({"engine": label, "available": available_flag, "detail": detail})

    # Make the consequence explicit rather than leaving it to the reader.
    pymupdf = next(row for row in rows if row["engine"] == "pymupdf")
    pypdf = next(row for row in rows if row["engine"] == "pypdf")
    rows.append(
        {
            "engine": "pdf_engine_in_use",
            "available": bool(pymupdf["available"] or pypdf["available"]),
            "detail": "pymupdf" if pymupdf["available"] else ("pypdf" if pypdf["available"] else "none"),
        }
    )
    return rows


__all__ = [
    "BaseExtractor",
    "ExtractionError",
    "ExtractionResult",
    "SegmentDraft",
    "available",
    "engine_status",
    "register",
    "registry",
    "resolve",
]
