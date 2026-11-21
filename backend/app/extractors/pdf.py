"""PDF extraction: PyMuPDF primary, pypdf fallback.

Hard rules (see AGENTS.md invariants 3 and 4):
  * `import pymupdf` only — never the legacy `import fitz`.
  * Page numbers are 1-based at this boundary and stay that way downstream.
  * A page with no text but with images/drawings is `is_scanned = True`, not silently dropped.
  * A page that raises is recorded as `failed` with its error; nothing is dropped.
  * Handles are closed immediately (`with pymupdf.open(...)`) to protect the 512 MB Render budget.
"""

from __future__ import annotations

import io
import logging
from typing import Any

from ..models.common import ProcessingStatus, SegmentStatus, SourceFormat
from ..text import humanize_title
from .base import BaseExtractor, ExtractionError, ExtractionResult, SegmentDraft

log = logging.getLogger(__name__)

MAX_PAGES = 2000  # a 2 000-page PDF already needs a deliberate decision
MAX_CHARS_PER_PAGE = 40000


def _page_draft(index: int, text: str, *, is_scanned: bool, engine: str, extra: dict | None = None) -> SegmentDraft:
    cleaned = (text or "").strip()
    if cleaned:
        status = SegmentStatus.ok
    elif is_scanned:
        status = SegmentStatus.scanned
    else:
        status = SegmentStatus.empty
    return SegmentDraft(
        segment_index=index,
        segment_label=f"Page {index}",
        content=cleaned[:MAX_CHARS_PER_PAGE],
        is_scanned=is_scanned and not cleaned,
        extraction_status=status,
        metadata={"engine": engine, "chars": len(cleaned), **(extra or {})},
    )


class PdfExtractor(BaseExtractor):
    name = "pdf"
    formats = (SourceFormat.pdf,)
    mime_types = ("application/pdf",)
    extensions = (".pdf",)

    def __init__(self) -> None:
        self._pymupdf_unavailable_logged = False

    # ------------------------------------------------------------------- public
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
            raise ExtractionError("PDF extraction needs the file bytes (pasted text is not a PDF)")

        attempts: list[tuple[str, ExtractionResult | None, str]] = []
        for engine_name, runner in (("pymupdf", self._with_pymupdf), ("pypdf", self._with_pypdf)):
            try:
                result = runner(data)
            except ImportError as exc:
                attempts.append((engine_name, None, f"not importable ({exc})"))
                continue
            except Exception as exc:
                attempts.append((engine_name, None, f"{type(exc).__name__}: {exc}"))
                continue
            attempts.append((engine_name, result, "ok"))
            if result.segments:
                result.title = humanize_title(filename) if filename else result.title
                return result

        detail = "; ".join(f"{name}: {why}" for name, _, why in attempts)
        raise ExtractionError(f"no PDF engine could read this document ({detail})")

    # ------------------------------------------------------------------- engines
    def _with_pymupdf(self, data: bytes) -> ExtractionResult:
        import pymupdf  # noqa: PLC0415

        segments: list[SegmentDraft] = []
        warnings: list[str] = []
        with pymupdf.open(stream=data, filetype="pdf") as document:  # closes immediately
            page_count = document.page_count
            if page_count > MAX_PAGES:
                warnings.append(
                    f"Document has {page_count} pages; only the first {MAX_PAGES} were indexed."
                )
            for page_number in range(min(page_count, MAX_PAGES)):
                index = page_number + 1  # 1-based, always
                try:
                    page = document[page_number]
                    text = page.get_text("text") or ""
                    images = []
                    try:
                        images = page.get_images(full=True)
                    except Exception:  # pragma: no cover - malformed resource dicts
                        images = []
                    drawings = 0
                    try:
                        drawings = len(page.get_drawings())
                    except Exception:  # pragma: no cover - older builds
                        drawings = 0
                    is_scanned = not text.strip() and bool(images or drawings)
                    segments.append(
                        _page_draft(
                            index,
                            text,
                            is_scanned=is_scanned,
                            engine="pymupdf",
                            extra={"images": len(images), "drawings": drawings},
                        )
                    )
                except Exception as exc:
                    segments.append(
                        SegmentDraft(
                            segment_index=index,
                            segment_label=f"Page {index}",
                            content="",
                            extraction_status=SegmentStatus.failed,
                            metadata={"engine": "pymupdf", "error": f"{type(exc).__name__}: {exc}"},
                        )
                    )
                    warnings.append(f"Page {index} could not be read: {exc}")

        return self._finish(segments, "pymupdf", warnings, page_count=len(segments))

    def _with_pypdf(self, data: bytes) -> ExtractionResult:
        from pypdf import PdfReader  # noqa: PLC0415

        segments: list[SegmentDraft] = []
        warnings: list[str] = []
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:
                raise ExtractionError(f"PDF is encrypted and cannot be opened: {exc}")

        pages = reader.pages
        if len(pages) > MAX_PAGES:
            warnings.append(
                f"Document has {len(pages)} pages; only the first {MAX_PAGES} were indexed."
            )
        for page_number in range(min(len(pages), MAX_PAGES)):
            index = page_number + 1  # 1-based, always
            try:
                page = pages[page_number]
                text = page.extract_text() or ""
                image_count = 0
                try:
                    image_count = len(list(page.images))
                except Exception:  # pragma: no cover - optional image filter deps
                    image_count = 0
                has_resources = image_count > 0
                if not has_resources:
                    # Any content stream at all (vector art, a scan placed as form
                    # XObject) means "no text but not empty" => treat as scanned.
                    # A ContentStream prints as {} but still holds data, so check
                    # the raw bytes rather than truthiness of the object.
                    try:
                        contents = page.get_contents()
                        stream_bytes = len(contents.get_data()) if contents is not None else 0
                    except Exception:
                        stream_bytes = 0
                    has_resources = stream_bytes > 0
                is_scanned = not text.strip() and has_resources
                segments.append(
                    _page_draft(
                        index,
                        text,
                        is_scanned=is_scanned,
                        engine="pypdf",
                        extra={"images": image_count},
                    )
                )
            except Exception as exc:
                segments.append(
                    SegmentDraft(
                        segment_index=index,
                        segment_label=f"Page {index}",
                        content="",
                        extraction_status=SegmentStatus.failed,
                        metadata={"engine": "pypdf", "error": f"{type(exc).__name__}: {exc}"},
                    )
                )
                warnings.append(f"Page {index} could not be read: {exc}")

        return self._finish(segments, "pypdf", warnings, page_count=len(segments))

    # ------------------------------------------------------------------- report
    @staticmethod
    def _finish(
        segments: list[SegmentDraft],
        engine: str,
        warnings: list[str],
        *,
        page_count: int,
    ) -> ExtractionResult:
        if not segments:
            raise ExtractionError("the PDF has no pages")
        ok = sum(1 for segment in segments if segment.extraction_status is SegmentStatus.ok)
        bad = len(segments) - ok
        if ok == 0:
            status = ProcessingStatus.needs_enrichment
        elif bad:
            status = ProcessingStatus.partial
        else:
            status = ProcessingStatus.ready
        return ExtractionResult(
            segments=segments,
            engine=engine,
            status=status,
            warnings=warnings,
            metadata={"page_count": page_count, "engine": engine},
        )
