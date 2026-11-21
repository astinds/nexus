"""Web article extraction with link-rot protection.

Order of preference for the readable text:
  1. trafilatura (best boilerplate removal),
  2. BeautifulSoup with a <article>/<main> heuristic,
  3. a plain-text fallback that keeps whole paragraphs.

Whatever happens, the raw HTML is handed back as `ExtractionResult.archival` so the
caller can store an archival snapshot. A dead link then never destroys the reference,
and `POST /api/v1/ingest` with pasted text remains the manual route for sites that
block bots entirely.
"""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urlparse

from ..models.common import ProcessingStatus, SegmentStatus, SourceFormat
from ..text import chunk_paragraphs, split_markdown_sections
from .base import BaseExtractor, ExtractionError, ExtractionResult, SegmentDraft

log = logging.getLogger(__name__)

MAX_HTML_BYTES = 8 * 1024 * 1024  # refuse absurd pages before parsing them
USER_AGENT = (
    "Mozilla/5.0 (compatible; NEXUS/1.0; +https://github.com/nexus) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
)
MIN_USEFUL_WORDS = 120


class WebArticleExtractor(BaseExtractor):
    name = "web_article"
    formats = (SourceFormat.web_article,)
    mime_types = ("text/html", "application/xhtml+xml")
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
        hints = hints or {}
        url = hints.get("url")

        if text is not None and not data:
            # Manual paste fallback: no archival snapshot is possible, and that is
            # stated rather than hidden.
            return self._from_text(text, url=url, title=hints.get("title"))

        if not data:
            raise ExtractionError("no HTML payload was supplied")

        if len(data) > MAX_HTML_BYTES:
            raise ExtractionError(
                f"the page is larger than {MAX_HTML_BYTES // (1024 * 1024)} MB; capture it as a file instead"
            )

        html = self._decode(data)
        warnings: list[str] = []
        title = hints.get("title") or self._title(html, url)

        body, engine = self._readable_text(html, warnings)
        if not body.strip():
            raise ExtractionError(
                "no readable text found (the page may be JavaScript-only or bot-blocked); "
                "use 'Paste Article / Transcript' instead"
            )

        segments, sectioned = self._segmentise(body)
        word_count = sum(len(segment.content.split()) for segment in segments)
        if word_count < MIN_USEFUL_WORDS:
            warnings.append(
                f"Only {word_count} words were extracted; the page may be truncated or "
                "mostly scripts. The archival snapshot is kept either way."
            )
            status = ProcessingStatus.needs_enrichment
        elif any(segment.extraction_status is SegmentStatus.empty for segment in segments):
            status = ProcessingStatus.partial
        else:
            status = ProcessingStatus.ready

        return ExtractionResult(
            segments=segments,
            engine=engine,
            title=title,
            status=status,
            warnings=warnings,
            archival=data,
            metadata={
                "url": url,
                "word_count": word_count,
                "sections": len(segments),
                "sectioned": sectioned,
                "html_bytes": len(data),
            },
        )

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _decode(data: bytes) -> str:
        for encoding in ("utf-8", "cp1252", "latin-1"):
            try:
                return data.decode(encoding)
            except UnicodeDecodeError:
                continue
        return data.decode("utf-8", errors="replace")

    @staticmethod
    def _title(html: str, url: str | None) -> str:
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "lxml")
            og = soup.find("meta", property="og:title")
            if og and og.get("content"):
                return str(og["content"]).strip()[:300]
            if soup.title and soup.title.string:
                return soup.title.string.strip()[:300]
        except Exception:  # pragma: no cover - fall through to the URL
            pass
        if url:
            return urlparse(url).path.rstrip("/").rsplit("/", 1)[-1][:120] or urlparse(url).netloc
        return "Web article"

    @staticmethod
    def _readable_text(html: str, warnings: list[str]) -> tuple[str, str]:
        try:
            import trafilatura

            extracted = trafilatura.extract(
                html,
                include_comments=False,
                include_tables=True,
                favor_precision=True,
                output_format="markdown",
            )
            if extracted and extracted.strip():
                return extracted.strip(), "trafilatura"
        except Exception as exc:
            warnings.append(f"trafilatura failed ({type(exc).__name__}); used BeautifulSoup instead.")

        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "lxml")
            for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "noscript"]):
                tag.decompose()
            container = soup.find("article") or soup.find("main") or soup.body or soup
            text = container.get_text("\n")
            lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
            cleaned = "\n".join(line for line in lines if line)
            if cleaned.strip():
                return cleaned.strip(), "beautifulsoup"
        except Exception as exc:
            warnings.append(f"BeautifulSoup failed ({type(exc).__name__}).")

        return "", "none"

    @staticmethod
    def _segmentise(body: str) -> tuple[list[SegmentDraft], bool]:
        sections = split_markdown_sections(body)
        sectioned = any(label != "Body" for label, _ in sections)
        segments: list[SegmentDraft] = []
        index = 1
        for label, content in sections:
            for position, chunk in enumerate(chunk_paragraphs(content, max_chars=8000)):
                resolved = label if label != "Body" else "Article"
                if position:
                    resolved = f"{resolved} (cont. {position})"
                segments.append(
                    SegmentDraft(
                        segment_index=index,
                        segment_label=resolved[:200],
                        content=chunk,
                        extraction_status=SegmentStatus.ok if chunk.strip() else SegmentStatus.empty,
                        metadata={"chars": len(chunk)},
                    )
                )
                index += 1
        if not segments:
            segments = [
                SegmentDraft(
                    segment_index=1,
                    segment_label="Article",
                    content="",
                    extraction_status=SegmentStatus.empty,
                )
            ]
        return segments, sectioned

    def _from_text(self, text: str, *, url: str | None, title: str | None) -> ExtractionResult:
        segments, sectioned = self._segmentise(text)
        word_count = sum(len(segment.content.split()) for segment in segments)
        warnings = [
            "Captured from pasted text: no archival snapshot exists for this item."
        ]
        if word_count < MIN_USEFUL_WORDS:
            warnings.append(f"Only {word_count} words were pasted.")
        return ExtractionResult(
            segments=segments,
            engine="manual-paste",
            title=title or (urlparse(url).netloc if url else "Pasted article"),
            status=ProcessingStatus.ready if text.strip() else ProcessingStatus.needs_enrichment,
            warnings=warnings,
            archival=None,
            metadata={"url": url, "word_count": word_count, "sectioned": sectioned, "manual": True},
        )

    # ----------------------------------------------------------------- fetching
    @staticmethod
    def fetch(url: str, *, timeout: float = 20.0) -> tuple[bytes, str]:
        """Download the page. Raises ExtractionError with a human-readable reason."""
        import httpx

        try:
            with httpx.Client(
                timeout=timeout,
                follow_redirects=True,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "en;q=0.9,*;q=0.5",
                },
            ) as client:
                with client.stream("GET", url) as response:
                    if response.status_code >= 400:
                        raise ExtractionError(
                            f"the site answered HTTP {response.status_code}; "
                            "use 'Paste Article / Transcript' instead"
                        )
                    chunks: list[bytes] = []
                    total = 0
                    for chunk in response.iter_bytes():
                        total += len(chunk)
                        if total > MAX_HTML_BYTES:
                            raise ExtractionError("the page is too large to capture")
                        chunks.append(chunk)
                    return b"".join(chunks), response.headers.get("content-type", "")
        except ExtractionError:
            raise
        except httpx.HTTPError as exc:
            raise ExtractionError(f"could not fetch the page: {type(exc).__name__}: {exc}")
