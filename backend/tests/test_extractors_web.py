"""Web article extraction: readable text, boundaries, snapshot handling, fallbacks."""

from __future__ import annotations

import pytest

from app.extractors import ExtractionError
from app.extractors.web import MIN_USEFUL_WORDS, WebArticleExtractor
from app.models import ProcessingStatus, SourceFormat

ARTICLE_HTML = b"""<!doctype html>
<html><head><title>Cooling Demand in South Asia</title>
<meta property="og:title" content="Cooling Demand in South Asia">
<style>.x{color:red}</style><script>var tracking=1;</script></head>
<body>
<nav>Home | About | Subscribe</nav>
<article>
  <h1>Cooling Demand in South Asia</h1>
  <p>Household air-conditioning ownership rose from four percent to nineteen percent
     between 2010 and 2023, driven by rising incomes and longer heatwaves.</p>
  <h2>Why it matters</h2>
  <p>Peak summer load now exceeds the installed baseload in three states, forcing
     distribution companies to buy spot power at four times the contracted rate.</p>
  <h2>What could change it</h2>
  <p>Efficient units cut demand by a third, and shading retrofits cut it further still.</p>
</article>
<footer>Copyright 2024</footer>
</body></html>"""


def test_extracts_title_and_sections() -> None:
    result = WebArticleExtractor().extract(data=ARTICLE_HTML, hints={"url": "https://example.org/a"})
    assert result.title == "Cooling Demand in South Asia"
    assert result.engine in {"trafilatura", "beautifulsoup"}
    assert result.metadata["url"] == "https://example.org/a"
    assert [segment.segment_index for segment in result.segments] == list(
        range(1, len(result.segments) + 1)
    )


def test_script_and_nav_noise_is_removed() -> None:
    result = WebArticleExtractor().extract(data=ARTICLE_HTML, hints={"url": "https://example.org/a"})
    joined = " ".join(segment.content for segment in result.segments)
    assert "tracking" not in joined
    assert "Subscribe" not in joined


def test_archival_snapshot_is_returned_byte_for_byte() -> None:
    result = WebArticleExtractor().extract(data=ARTICLE_HTML, hints={"url": "https://example.org/a"})
    assert result.archival == ARTICLE_HTML


def test_thin_page_is_flagged_and_warns() -> None:
    html = b"<html><body><article><p>Too short.</p></article></body></html>"
    result = WebArticleExtractor().extract(data=html, hints={"url": "https://example.org/thin"})
    assert result.status is ProcessingStatus.needs_enrichment
    assert any("words" in warning for warning in result.warnings)


def test_page_with_no_readable_text_raises_with_advice() -> None:
    html = b"<html><body><script>render()</script></body></html>"
    with pytest.raises(ExtractionError) as excinfo:
        WebArticleExtractor().extract(data=html, hints={"url": "https://example.org/js"})
    assert "Paste Article" in str(excinfo.value)


def test_oversized_page_is_refused_before_parsing() -> None:
    big = b"<html><body>" + b"x" * (9 * 1024 * 1024) + b"</body></html>"
    with pytest.raises(ExtractionError) as excinfo:
        WebArticleExtractor().extract(data=big)
    assert "larger" in str(excinfo.value).lower()


def test_manual_paste_fallback_states_the_missing_snapshot() -> None:
    body = "A pasted transcript with enough words to be useful. " * (MIN_USEFUL_WORDS // 8 + 1)
    result = WebArticleExtractor().extract(text=body, hints={"url": "https://example.org/x"})
    assert result.engine == "manual-paste"
    assert result.archival is None
    assert any("no archival snapshot" in warning for warning in result.warnings)


def test_paste_fallback_keeps_short_text_but_says_so() -> None:
    result = WebArticleExtractor().extract(text="short note")
    assert result.segments[0].content
    assert any("words were pasted" in warning for warning in result.warnings)


def test_extractor_claims_web_format() -> None:
    extractor = WebArticleExtractor()
    assert extractor.supports(source_format=SourceFormat.web_article) is True
    assert extractor.supports(mime_type="text/html") is True
    assert extractor.supports(mime_type="application/pdf") is False


def test_network_error_is_wrapped_not_leaked() -> None:
    with pytest.raises(ExtractionError):
        WebArticleExtractor.fetch("https://127.0.0.1:9/definitely-not-listening", timeout=1.0)
