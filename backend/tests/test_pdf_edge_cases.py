"""Phase 2 — hostile input and 512 MB memory safety.

Three production failure modes are pinned here:

  1. PostgreSQL rejects U+0000 in a text literal, and it used to reject the whole
     INSERT: a malformed PDF font produced a 500 instead of a readable item.
  2. Broken PDFs must fail as a clear 4xx, never a traceback, and must not leave
     file descriptors behind on a host that only has 512 MB.
  3. One hostile document must not be able to pull unbounded text into RAM.

Everything is generated in memory; no binary fixtures are committed.
"""

from __future__ import annotations

import os
from io import BytesIO
from types import SimpleNamespace

import pytest

from app.api.ingest import _spool_upload
from app.errors import ApiError
from app.extractors import ExtractionError
from app.extractors.base import SegmentDraft
from app.extractors.pdf import PdfExtractor
from app.models import ProcessingStatus, SegmentStatus
from app.text import sanitize_text, sanitize_tree

from tests.fixtures.hostile import (
    MIXED_PAGE_TEXT,
    corrupted_header_pdf,
    encrypted_pdf,
    html_renamed_to_pdf,
    mixed_three_page_pdf,
    truncated_pdf,
)

# ----------------------------------------------------------------- 1. NUL bytes


def test_sanitize_text_removes_nul_but_keeps_layout_characters() -> None:
    dirty = "Ti\x00tle\nwith\ttabs and\r\nnewlines\x00."
    clean = sanitize_text(dirty)
    assert "\x00" not in clean
    assert "\n" in clean and "\t" in clean and "\r" in clean
    assert clean.startswith("Title")


def test_sanitize_text_is_a_noop_for_clean_text() -> None:
    clean = "Ordinary prose — with punctuation, ünïcode and 中文."
    assert sanitize_text(clean) is clean  # identity: no needless copy


def test_sanitize_text_strips_other_c0_controls() -> None:
    assert sanitize_text("a\x01b\x07c\x1fd") == "abcd"


def test_sanitize_tree_cleans_nested_metadata() -> None:
    payload = {"engine": "pypdf", "notes": ["a\x00b", {"deep": "c\x00d"}], "n": 3}
    cleaned = sanitize_tree(payload)
    assert cleaned["engine"] == "pypdf"
    assert cleaned["notes"][0] == "ab"
    assert cleaned["notes"][1]["deep"] == "cd"
    assert cleaned["n"] == 3


def test_segment_row_never_carries_nul_into_the_insert() -> None:
    """as_row() is the boundary between extraction and SQL: it must scrub."""
    draft = SegmentDraft(
        segment_index=1,
        segment_label="Page\x001",
        content="body\x00text",
        metadata={"engine": "pypdf\x00", "error": "boom\x00"},
    )
    row = draft.as_row()
    assert "\x00" not in row["segment_label"]
    assert "\x00" not in row["content"]
    assert "\x00" not in str(row["metadata"])


def test_sanitize_text_handles_none_and_empty() -> None:
    assert sanitize_text(None) == ""
    assert sanitize_text("") == ""


# ------------------------------------------------------- 2. hostile PDF inputs


def test_zero_byte_file_is_rejected() -> None:
    with pytest.raises(ExtractionError):
        PdfExtractor().extract(data=b"", filename="empty.pdf")


@pytest.mark.parametrize(
    "payload,label",
    [
        (truncated_pdf(), "truncated"),
        (corrupted_header_pdf(), "corrupted header"),
        (html_renamed_to_pdf(), "html renamed to .pdf"),
    ],
)
def test_broken_pdf_raises_extraction_error_not_a_traceback(payload: bytes, label: str) -> None:
    with pytest.raises(ExtractionError) as excinfo:
        PdfExtractor().extract(data=payload, filename="broken.pdf")
    message = str(excinfo.value)
    assert message  # honest, non-empty reason
    assert "password-protected" not in message, label


def test_encrypted_pdf_reports_password_protection_clearly() -> None:
    with pytest.raises(ExtractionError) as excinfo:
        PdfExtractor().extract(data=encrypted_pdf(), filename="locked.pdf")
    assert "password-protected" in str(excinfo.value)


def test_encrypted_pdf_message_tells_the_user_what_to_do() -> None:
    with pytest.raises(ExtractionError) as excinfo:
        PdfExtractor().extract(data=encrypted_pdf(), filename="locked.pdf")
    assert "remove the password" in str(excinfo.value)


# ------------------------------------------------------ mixed / honest per page


def test_mixed_document_classifies_every_page_honestly() -> None:
    result = PdfExtractor().extract(data=mixed_three_page_pdf(), filename="mixed.pdf")

    assert [seg.segment_label for seg in result.segments] == ["Page 1", "Page 2", "Page 3"]
    page1, page2, page3 = result.segments

    assert page1.extraction_status is SegmentStatus.ok
    assert MIXED_PAGE_TEXT in page1.content
    assert page1.is_scanned is False

    assert page2.extraction_status is SegmentStatus.scanned
    assert page2.is_scanned is True
    assert page2.content == ""

    # A blank page is `empty`, never `scanned`: mislabelling it wastes reader time.
    assert page3.extraction_status is SegmentStatus.empty
    assert page3.is_scanned is False

    assert result.status is ProcessingStatus.partial


# --------------------------------------------------------------- 3. memory caps


def test_total_text_budget_truncates_instead_of_hoarding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tiny budget stands in for MAX_TOTAL_CHARS so the cap is observable."""
    import app.extractors.pdf as pdf_module

    monkeypatch.setattr(pdf_module, "MAX_TOTAL_CHARS", 12)

    result = PdfExtractor().extract(data=mixed_three_page_pdf(), filename="mixed.pdf")
    total = sum(len(seg.content) for seg in result.segments)
    assert total <= 12
    assert any("were not indexed" in warning for warning in result.warnings)
    assert any(seg.metadata.get("truncated") for seg in result.segments)


def test_per_page_cap_is_enforced() -> None:
    import app.extractors.pdf as pdf_module

    assert pdf_module.MAX_CHARS_PER_PAGE > 0
    draft = SegmentDraft(
        segment_index=1,
        segment_label="Page 1",
        content="x" * (pdf_module.MAX_CHARS_PER_PAGE + 100),
    )
    # _page_draft is the only truncation point per page; exercise it directly.
    from app.extractors.pdf import _page_draft

    page = _page_draft(1, draft.content, is_scanned=False, engine="test")
    assert len(page.content) == pdf_module.MAX_CHARS_PER_PAGE


def _fake_upload(payload: bytes) -> SimpleNamespace:
    return SimpleNamespace(file=BytesIO(payload))


def test_upload_cap_is_enforced_while_reading() -> None:
    """The 413 must fire mid-stream, not after buffering an unbounded body."""
    big = SimpleNamespace(file=BytesIO(b"x" * 50_000))
    with pytest.raises(ApiError) as excinfo:
        _spool_upload(big, max_bytes=1_000)
    assert excinfo.value.status_code == 413
    assert excinfo.value.code == "file_too_large"


def test_upload_within_cap_returns_exact_bytes() -> None:
    payload = b"%PDF-1.4\nsmall"
    data, total = _spool_upload(_fake_upload(payload), max_bytes=10_000)
    assert data == payload
    assert total == len(payload)


def test_repeated_uploads_do_not_leak_file_descriptors() -> None:
    """The spool is a NamedTemporaryFile: it must be closed on both paths."""
    def fd_count() -> int:
        return len(os.listdir("/proc/self/fd"))

    payload = b"y" * 5_000
    before = fd_count()
    for _ in range(15):
        _spool_upload(_fake_upload(payload), max_bytes=10_000)
    after_ok = fd_count()

    for _ in range(15):
        with pytest.raises(ApiError):
            _spool_upload(_fake_upload(b"z" * 5_000), max_bytes=1_000)
    after_reject = fd_count()

    # Allow a little slack for unrelated interpreter activity.
    assert after_ok - before <= 2
    assert after_reject - before <= 2
