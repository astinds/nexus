"""Small text and hashing utilities shared by services, extractors and repos."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Iterable

SLUG_STRIP_RE = re.compile(r"[^a-z0-9]+")
WORD_RE = re.compile(r"\S+")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
YAML_SAFE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.,:/()'-]*$")

# Comfortable adult reading pace for non-fiction prose.
WORDS_PER_MINUTE = 200


def read_minutes(word_count: int) -> int:
    """Reading-time estimate in whole minutes; 0 for empty documents."""
    if not word_count or word_count < 0:
        return 0
    return max(1, round(word_count / WORDS_PER_MINUTE))


def slugify(value: str, *, fallback: str = "workspace", max_length: int = 60) -> str:
    normalised = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode()
    slug = SLUG_STRIP_RE.sub("-", normalised.lower()).strip("-")
    return (slug or fallback)[:max_length].strip("-") or fallback


def humanize_title(filename: str) -> str:
    """`my_great-paper.v2.pdf` -> `My Great Paper V2`."""
    stem = (filename or "").rsplit("/", 1)[-1]
    stem = re.sub(r"\.[A-Za-z0-9]{1,8}$", "", stem)
    stem = re.sub(r"[_\-+]+", " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem[:1].upper() + stem[1:] if stem else "Untitled"


def count_words(text: str) -> int:
    return len(WORD_RE.findall(text or ""))


def sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data or b"").hexdigest()


def short_hash(value: str, length: int = 12) -> str:
    return (value or "")[:length]


def quote_yaml_scalar(value: object) -> str:
    """Deterministic YAML scalar for export frontmatter.

    Values that could be misread as numbers, booleans, dates or YAML syntax are
    double quoted with backslash escaping; everything else stays plain.
    """
    if value is None:
        return '""'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text == "":
        return '""'
    ambiguous = text.lower() in {"true", "false", "yes", "no", "null", "~", "on", "off"}
    looks_numeric = re.match(r"^[+-]?\d+(\.\d+)?$", text) is not None
    looks_date = re.match(r"^\d{4}-\d{2}-\d{2}", text) is not None
    if ambiguous or looks_numeric or looks_date or not YAML_SAFE_RE.match(text):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'
    return text


def split_markdown_sections(text: str) -> list[tuple[str, str]]:
    """Split Markdown-ish text at headings.

    Returns [(label, body)] where label is the heading text, or ("Body", text)
    when the document has no headings. Headings themselves are kept in the body
    so exported Markdown round-trips unchanged.
    """
    lines = (text or "").splitlines()
    sections: list[tuple[str, list[str]]] = []
    current_label: str | None = None
    buffer: list[str] = []

    for line in lines:
        match = HEADING_RE.match(line)
        if match:
            if current_label is not None or buffer:
                sections.append((current_label or "Body", buffer))
            current_label = match.group(2).strip() or "Untitled section"
            buffer = [line]
        else:
            buffer.append(line)

    if current_label is not None or buffer:
        sections.append((current_label or "Body", buffer))

    cleaned: list[tuple[str, str]] = []
    for label, body_lines in sections:
        body = "\n".join(body_lines).strip()
        if body:
            cleaned.append((label, body))
    if not cleaned:
        cleaned.append(("Body", ""))
    return cleaned


def chunk_paragraphs(text: str, *, max_chars: int = 4000) -> list[str]:
    """Split long plain text into chunks at paragraph boundaries."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text or "") if p.strip()]
    if not paragraphs:
        return [""]
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for paragraph in paragraphs:
        if current and size + len(paragraph) > max_chars:
            chunks.append("\n\n".join(current))
            current, size = [], 0
        current.append(paragraph)
        size += len(paragraph) + 2
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def truncate(text: str, limit: int = 300) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "\u2026"


def unique_in_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.strip().lower()
        if key and key not in seen:
            seen.add(key)
            result.append(value.strip())
    return result
