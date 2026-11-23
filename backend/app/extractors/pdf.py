"""PDF extraction: PyMuPDF primary, pypdf fallback.

Hard rules (see AGENTS.md invariants 3 and 4):
  * `import pymupdf` only — never the legacy `import fitz`.
  * Page numbers are 1-based at this boundary and stay that way downstream.
  * A page with no text but real image/drawing content is `is_scanned = True`.
    A page whose content stream is blank, whitespace or comments only is `empty`,
    never `scanned`: mislabelling a blank page wastes the reader's time.
  * A page that raises is recorded as `failed` with its error; nothing is dropped.
  * Handles are closed immediately (`with pymupdf.open(...)`) to protect the
    512 MB Render budget.
"""

from __future__ import annotations

import io
import re
from typing import Any

from ..models.common import ProcessingStatus, SegmentStatus, SourceFormat
from ..text import humanize_title
from .base import BaseExtractor, ExtractionError, ExtractionResult, SegmentDraft

MAX_PAGES = 2000  # a 2 000-page PDF already needs a deliberate decision
MAX_CHARS_PER_PAGE = 40000
# 2 000 pages x 40 000 chars would be ~80 MB of Python str in RAM before it ever
# reaches PostgreSQL; 4 M characters is still ~2000 book pages of prose.
MAX_TOTAL_CHARS = 4_000_000

# PDF comments run to end of line; everything else that is whitespace carries no
# drawing instruction, so both can be ignored when deciding "is this page empty?".
PDF_COMMENT_RE = re.compile(rb"%[^\r\n]*")


def meaningful_stream_bytes(raw: bytes | None) -> int:
    """Count content-stream bytes that are actual operators.

    A blank page may still own a content stream containing only a comment or
    whitespace. Counting raw length would misclassify it as an image-only page.
    """
    if not raw:
        return 0
    without_comments = PDF_COMMENT_RE.sub(b"", raw)
    return len(b"".join(without_comments.split()))


def _page_draft(
    index: int, text: str, *, is_scanned: bool, engine: str, extra: dict | None = None
) -> SegmentDraft:
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

        attempts: list[tuple[str, str]] = []
        for engine_name, runner in (("pymupdf", self._with_pymupdf), ("pypdf", self._with_pypdf)):
            try:
                result = runner(data)
            except ImportError as exc:
                attempts.append((engine_name, f"not importable ({exc})"))
                continue
            except Exception as exc:
                attempts.append((engine_name, f"{type(exc).__name__}: {exc}"))
                continue
            if result.segments:
                result.title = humanize_title(filename) if filename else result.title
                return self._apply_text_budget(result)
            attempts.append((engine_name, "no pages produced"))

        reasons = [why for _, why in attempts]
        if any("password-protected" in reason for reason in reasons):
            raise ExtractionError(
                "PDF is password-protected: remove the password and upload again."
            )
        detail = "; ".join(f"{name}: {why}" for name, why in attempts)
        raise ExtractionError(f"no PDF engine could read this document ({detail})")

    @staticmethod
    def _apply_text_budget(result: ExtractionResult) -> ExtractionResult:
        """Cap total extracted text so one hostile PDF cannot exhaust 512 MB.

        Per-page truncation already exists; this bounds the sum. Later pages keep
        their numbering but carry no content, and the item is marked partial with a
        warning, so nothing silently pretends to be complete.
        """
        used = 0
        dropped: list[int] = []
        for segment in result.segments:
            if used >= MAX_TOTAL_CHARS:
                segment.content = ""
                segment.is_scanned = False
                segment.metadata = {**segment.metadata, "truncated": True}
                dropped.append(segment.segment_index)
                continue
            remaining = MAX_TOTAL_CHARS - used
            if len(segment.content) > remaining:
                segment.content = segment.content[:remaining]
                segment.metadata = {**segment.metadata, "truncated": True}
            used += len(segment.content)

        if dropped:
            result.warnings.append(
                f"Document text exceeded {MAX_TOTAL_CHARS:,} characters; "
                f"pages {dropped[0]}-{dropped[-1]} were not indexed."
            )
        return result

    # ------------------------------------------------------------------ engines
    def _with_pymupdf(self, data: bytes) -> ExtractionResult:
        import pymupdf  # noqa: PLC0415

        segments: list[SegmentDraft] = []
        warnings: list[str] = []
        with pymupdf.open(stream=data, filetype="pdf") as document:  # closes immediately
            # PyMuPDF opens an encrypted file without raising and then fails on the
            # first page access. Say so plainly instead of returning failed pages.
            if document.needs_pass:
                raise ExtractionError(
                    "PDF is password-protected: remove the password and upload again."
                )
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
                    try:
                        image_count = len(page.get_images(full=True))
                    except Exception:  # pragma: no cover - malformed resource dicts
                        image_count = 0
                    try:
                        drawings = len(page.get_drawings())
                    except Exception:  # pragma: no cover - older builds
                        drawings = 0
                    is_scanned = not text.strip() and bool(image_count or drawings)
                    segments.append(
                        _page_draft(
                            index,
                            text,
                            is_scanned=is_scanned,
                            engine="pymupdf",
                            extra={"images": image_count, "drawings": drawings},
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

        return self._finish(segments, "pymupdf", warnings)

    def _with_pypdf(self, data: bytes) -> ExtractionResult:
        from pypdf import PdfReader  # noqa: PLC0415

        segments: list[SegmentDraft] = []
        warnings: list[str] = []
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            # decrypt("") succeeds only for PDFs with an empty owner password; any
            # real password means "unreadable" and must read as such.
            try:
                opened = reader.decrypt("")
            except Exception:
                opened = 0
            if not opened:
                raise ExtractionError(
                    "PDF is password-protected: remove the password and upload again."
                )

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

                # len() reads the XObject reference list. list(page.images) would call
                # pypdf's _xobj_to_image for every image, decoding whole scans into RAM
                # and stalling on any document worth reading.
                try:
                    image_count = len(page.images)
                except Exception:  # pragma: no cover - malformed resources
                    image_count = 0

                stream_bytes = 0
                try:
                    contents = page.get_contents()
                    if contents is not None:
                        stream_bytes = meaningful_stream_bytes(contents.get_data())
                except Exception:  # pragma: no cover - broken content streams
                    stream_bytes = 0

                # pypdf has no get_drawings(); a content stream with real operators is
                # our evidence of visible-but-textless content (scans, vector art).
                has_content = image_count > 0 or stream_bytes > 0
                is_scanned = not text.strip() and has_content
                segments.append(
                    _page_draft(
                        index,
                        text,
                        is_scanned=is_scanned,
                        engine="pypdf",
                        extra={"images": image_count, "stream_bytes": stream_bytes},
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

        return self._finish(segments, "pypdf", warnings)

    # ------------------------------------------------------------------- report
    @staticmethod
    def _finish(
        segments: list[SegmentDraft], engine: str, warnings: list[str]
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
            metadata={"page_count": len(segments), "engine": engine},
        )
