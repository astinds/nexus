"""Text utilities: hashing, slugs, reading time, YAML-safe frontmatter, chunking."""

from __future__ import annotations

from app.text import (
    chunk_paragraphs,
    count_words,
    humanize_title,
    quote_yaml_scalar,
    read_minutes,
    sha256_bytes,
    sha256_text,
    short_hash,
    slugify,
    split_markdown_sections,
    truncate,
    unique_in_order,
)


def test_read_minutes_rounds_to_whole_minutes() -> None:
    assert read_minutes(0) == 0
    assert read_minutes(1) == 1
    assert read_minutes(200) == 1
    assert read_minutes(600) == 3
    assert read_minutes(300) == 2  # 1.5 rounds to banker's 2


def test_count_words_counts_whitespace_tokens() -> None:
    assert count_words("") == 0
    assert count_words("one two   three\nfour") == 4


def test_slugify_handles_unicode_and_spaces() -> None:
    assert slugify("My Great  Workspace!") == "my-great-workspace"
    assert slugify("Café Notes") == "cafe-notes"
    assert slugify("!!!") == "workspace"


def test_humanize_title_strips_extension_and_separators() -> None:
    assert humanize_title("/tmp/policy_brief-v2.pdf") == "Policy brief v2"
    assert humanize_title("note.markdown") == "Note"
    assert humanize_title("") == "Untitled"


def test_hashes_are_stable_and_distinct() -> None:
    assert sha256_text("abc") == sha256_text("abc")
    assert sha256_text("abc") != sha256_text("abd")
    assert len(sha256_text("abc")) == 64
    assert sha256_bytes(b"abc") == sha256_text("abc")
    assert short_hash("abcdef123456", 6) == "abcdef"


def test_quote_yaml_scalar_escapes_ambiguous_values() -> None:
    assert quote_yaml_scalar("Plain Title") == "Plain Title"
    assert quote_yaml_scalar("true") == '"true"'
    assert quote_yaml_scalar("2024-01-01") == '"2024-01-01"'
    assert quote_yaml_scalar("123") == '"123"'
    assert quote_yaml_scalar(7) == "7"
    assert quote_yaml_scalar(True) == "true"
    assert quote_yaml_scalar(None) == '""'
    assert quote_yaml_scalar('He said "hi"') == '"He said \\"hi\\""'


def test_split_markdown_sections_keeps_heading_text() -> None:
    body = "# Alpha\nfirst\n\n## Beta\nsecond\n"
    sections = split_markdown_sections(body)
    assert [label for label, _ in sections] == ["Alpha", "Beta"]
    assert "# Alpha" in sections[0][1]


def test_split_markdown_sections_without_headings_uses_body_label() -> None:
    assert split_markdown_sections("just text") == [("Body", "just text")]
    assert split_markdown_sections("") == [("Body", "")]


def test_chunk_paragraphs_respects_budget() -> None:
    text = "\n\n".join(["x" * 100 for _ in range(10)])
    chunks = chunk_paragraphs(text, max_chars=250)
    assert len(chunks) >= 4
    assert all(len(chunk) <= 400 for chunk in chunks)


def test_truncate_adds_ellipsis_only_when_needed() -> None:
    assert truncate("short", 10) == "short"
    assert truncate("a" * 20, 10).endswith("\u2026")
    assert len(truncate("a" * 20, 10)) == 10


def test_unique_in_order_is_case_insensitive() -> None:
    assert unique_in_order(["AI", "ai", "ML", "  ", "ml "]) == ["AI", "ML"]
