"""Extractor registry instance.

Registration order matters: the first extractor whose `supports()` matches wins, so
specific formats come before the generic text handlers.
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


def engine_status() -> list[dict[str, object]]:
    """Honest report of optional native engines, used by /api/v1/health."""
    rows: list[dict[str, object]] = []

    try:
        import pymupdf  # noqa: F401

        rows.append({"engine": "pymupdf", "available": True, "detail": "primary PDF engine"})
    except Exception as exc:
        rows.append(
            {
                "engine": "pymupdf",
                "available": False,
                "detail": f"{type(exc).__name__}: {exc}",
            }
        )

    try:
        import pypdf  # noqa: F401

        rows.append({"engine": "pypdf", "available": True, "detail": "pure-Python PDF fallback"})
    except Exception as exc:
        rows.append({"engine": "pypdf", "available": False, "detail": str(exc)})

    for module, label in (("docx", "python-docx"), ("trafilatura", "trafilatura"), ("bs4", "beautifulsoup4")):
        try:
            __import__(module)
            rows.append({"engine": label, "available": True, "detail": ""})
        except Exception as exc:
            rows.append({"engine": label, "available": False, "detail": str(exc)})

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
