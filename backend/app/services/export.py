"""Lossless export: Markdown + YAML frontmatter, JSON, BibTeX, APA, MLA and a
whole-library backup ZIP.

Design rules:
  * Export is round-trippable: the Markdown frontmatter carries every field the app
    owns, so an import task (v1.1) can rebuild the item.
  * YAML scalars are quoted when ambiguous (`quote_yaml_scalar`), so a title like
    "2024-01-01" never becomes a date.
  * No dependency on a YAML library: the frontmatter writer is small, explicit and
    tested. Any YAML parser reads the output.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from ..errors import bad_request
from ..models import ExportFormat, Segment
from ..text import quote_yaml_scalar

CITATION_FALLBACK_AUTHOR = "Unknown"
CITATION_FALLBACK_YEAR = "n.d."


# ------------------------------------------------------------------ frontmatter
def _yaml_list(key: str, values: list[str]) -> list[str]:
    if not values:
        return [f"{key}: []"]
    lines = [f"{key}:"]
    lines.extend(f"  - {quote_yaml_scalar(value)}" for value in values)
    return lines


def item_frontmatter(item: dict, *, tags: list[str], collections: list[str]) -> str:
    created = item.get("created_at")
    updated = item.get("updated_at")
    fields: list[str] = ["---"]
    fields.append(f"title: {quote_yaml_scalar(item.get('title'))}")
    fields.append(f"id: {quote_yaml_scalar(str(item.get('id')))}")
    fields.append(f"source_format: {quote_yaml_scalar(item.get('source_format'))}")
    fields.append(f"triage_status: {quote_yaml_scalar(item.get('triage_status'))}")
    fields.append(f"processing_status: {quote_yaml_scalar(item.get('processing_status'))}")
    fields.append(f"word_count: {int(item.get('word_count') or 0)}")
    fields.append(f"est_read_minutes: {int(item.get('est_read_minutes') or 0)}")
    if item.get("source_uri"):
        fields.append(f"source_uri: {quote_yaml_scalar(item['source_uri'])}")
    if item.get("snapshot_uri"):
        fields.append(f"snapshot_uri: {quote_yaml_scalar(item['snapshot_uri'])}")
    if item.get("content_hash"):
        fields.append(f"content_hash: {quote_yaml_scalar(item['content_hash'])}")
    if isinstance(created, datetime):
        fields.append(f"created: {created.isoformat()}")
    if isinstance(updated, datetime):
        fields.append(f"updated: {updated.isoformat()}")
    if item.get("summary"):
        fields.append(f"summary: {quote_yaml_scalar(item['summary'])}")
    fields.extend(_yaml_list("tags", tags))
    fields.extend(_yaml_list("collections", collections))

    custom = item.get("custom_fields") or {}
    if custom:
        fields.append("custom_fields:")
        for key, value in sorted(custom.items()):
            if isinstance(value, (list, tuple)):
                rendered = "[" + ", ".join(quote_yaml_scalar(entry) for entry in value) + "]"
            else:
                rendered = quote_yaml_scalar(value)
            fields.append(f"  {key}: {rendered}")

    progress = item.get("reading_progress") or {}
    if progress:
        fields.append("reading_progress:")
        for key in ("segment_index", "segment_label", "percent"):
            if key in progress and progress[key] is not None:
                fields.append(f"  {key}: {quote_yaml_scalar(progress[key])}")

    fields.append("---")
    return "\n".join(fields)


# ------------------------------------------------------------------- renderers
def render_markdown(
    item: dict,
    segments: list[dict],
    *,
    tags: list[str] | None = None,
    collections: list[str] | None = None,
) -> str:
    parts = [item_frontmatter(item, tags=tags or [], collections=collections or []), ""]
    parts.append(f"# {item.get('title') or 'Untitled'}")
    parts.append("")
    if item.get("summary"):
        parts.extend(["> " + str(item["summary"]).replace("\n", "\n> "), ""])
    for segment in segments:
        label = segment.get("segment_label") or f"Segment {segment.get('segment_index')}"
        parts.append(f"## {label}")
        parts.append("")
        content = (segment.get("content") or "").strip()
        if segment.get("is_scanned"):
            parts.append("_(scanned page: no extractable text — open the original file)_")
        elif not content:
            parts.append("_(empty segment)_")
        else:
            parts.append(content)
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def render_json(
    item: dict,
    segments: list[dict],
    *,
    tags: list[str] | None = None,
    collections: list[str] | None = None,
) -> str:
    payload: dict[str, Any] = {
        "nexus_export": {"version": 1, "exported_at": datetime.now(timezone.utc).isoformat()},
        "item": _jsonable(item),
        "tags": tags or [],
        "collections": collections or [],
        "segments": [_jsonable(segment) for segment in segments],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False, default=str)


def _jsonable(row: dict) -> dict:
    return {
        key: (value.isoformat() if isinstance(value, datetime) else value)
        for key, value in row.items()
    }


def _citation_parts(item: dict) -> tuple[str, str, str, str]:
    """author, year, title, source — from custom fields, metadata, then fallbacks."""
    custom = item.get("custom_fields") or {}
    metadata = item.get("metadata") or {}
    author = (
        custom.get("author")
        or custom.get("authors")
        or metadata.get("author")
        or metadata.get("byline")
        or ""
    )
    if isinstance(author, (list, tuple)):
        author = ", ".join(str(entry) for entry in author)
    year = custom.get("year") or custom.get("publication_year") or metadata.get("year") or ""
    if not year and isinstance(item.get("created_at"), datetime):
        year = item["created_at"].year
    title = str(item.get("title") or "Untitled")
    source = (
        item.get("source_uri")
        or metadata.get("url")
        or custom.get("publisher")
        or metadata.get("publisher")
        or ""
    )
    return (
        str(author).strip() or CITATION_FALLBACK_AUTHOR,
        str(year).strip() or CITATION_FALLBACK_YEAR,
        title,
        str(source).strip(),
    )


def _bibtex_key(item: dict) -> str:
    author, year, title, _ = _citation_parts(item)
    surname = re.sub(r"[^A-Za-z]", "", author.split(",")[0].split()[-1] if author != CITATION_FALLBACK_AUTHOR else "anon")
    first_word = re.sub(r"[^A-Za-z]", "", title.split()[0] if title.split() else "untitled")
    return f"{surname.lower() or 'anon'}{re.sub(r'[^0-9]', '', year) or ''}{first_word.lower() or 'item'}"


def render_bibtex(
    item: dict,
    segments: list[dict],
    *,
    tags: list[str] | None = None,
    collections: list[str] | None = None,
) -> str:
    author, year, title, source = _citation_parts(item)
    entry_type = "online" if item.get("source_format") == "web_article" else "misc"
    lines = [f"@{entry_type}{{{_bibtex_key(item)},"]
    lines.append(f"  title = {{{title}}},")
    if author != CITATION_FALLBACK_AUTHOR:
        lines.append(f"  author = {{{author}}},")
    if year != CITATION_FALLBACK_YEAR:
        lines.append(f"  year = {{{year}}},")
    if source:
        lines.append(f"  url = {{{source}}},")
    lines.append(f"  note = {{NEXUS {item.get('source_format')}, {item.get('word_count') or 0} words}},")
    lines.append("}")
    return "\n".join(lines) + "\n"


def render_apa(
    item: dict,
    segments: list[dict],
    *,
    tags: list[str] | None = None,
    collections: list[str] | None = None,
) -> str:
    author, year, title, source = _citation_parts(item)
    citation = f"{author} ({year}). {title}."
    if source:
        citation += f" {source}"
    return citation.strip() + "\n"


def render_mla(
    item: dict,
    segments: list[dict],
    *,
    tags: list[str] | None = None,
    collections: list[str] | None = None,
) -> str:
    author, _, title, source = _citation_parts(item)
    citation = f'{author}. "{title}."'
    if source:
        citation += f" {source}."
    return citation.strip() + "\n"


RENDERERS = {
    ExportFormat.markdown: render_markdown,
    ExportFormat.json: render_json,
    ExportFormat.bibtex: render_bibtex,
    ExportFormat.apa: render_apa,
    ExportFormat.mla: render_mla,
}

CONTENT_TYPES = {
    ExportFormat.markdown: "text/markdown; charset=utf-8",
    ExportFormat.json: "application/json",
    ExportFormat.bibtex: "application/x-bibtex; charset=utf-8",
    ExportFormat.apa: "text/plain; charset=utf-8",
    ExportFormat.mla: "text/plain; charset=utf-8",
}

EXTENSIONS = {
    ExportFormat.markdown: "md",
    ExportFormat.json: "json",
    ExportFormat.bibtex: "bib",
    ExportFormat.apa: "txt",
    ExportFormat.mla: "txt",
}


def _safe_slug(title: object) -> str:
    """Filenames must never escape their folder: no dots, no slashes, no leading dashes."""
    cleaned = re.sub(r"[^A-Za-z0-9 _-]", "", str(title or "")).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .-")
    return cleaned[:60] or "item"


def render(
    fmt: ExportFormat,
    item: dict,
    segments: list[dict],
    *,
    tags: list[str] | None = None,
    collections: list[str] | None = None,
) -> tuple[str, str, str]:
    """Return (body, media_type, filename) for one item."""
    renderer = RENDERERS.get(fmt)
    if renderer is None:  # pragma: no cover - guarded by the enum
        raise bad_request(f"unsupported export format '{fmt}'", code="unsupported_export")
    body = renderer(item, segments, tags=tags, collections=collections)
    safe_title = _safe_slug(item.get("title"))
    filename = f"{safe_title}.{EXTENSIONS[fmt]}"
    return body, CONTENT_TYPES[fmt], filename


# ------------------------------------------------------------------- backup zip
BACKUP_README = (
    "NEXUS library backup.\n\n"
    "items/*.md    one file per item: YAML frontmatter + segments\n"
    "library.json  machine-readable copy of every item row (no segment bodies)\n"
    "library.md    human index\n\n"
    "Frontmatter is Obsidian-compatible: drop the items/ folder into a vault.\n"
)

# Index files carry this projection only. Segment bodies are never buffered for
# the index, so RAM stays flat no matter how large the library is.
LIGHT_ROW_FIELDS = (
    "id",
    "title",
    "source_format",
    "triage_status",
    "processing_status",
    "word_count",
    "est_read_minutes",
    "created_at",
)


def _light_row(row: dict) -> dict:
    return {field: _jsonable({field: row.get(field)})[field] for field in LIGHT_ROW_FIELDS}


def write_library_zip(
    destination: "os.PathLike[str] | str",
    *,
    rows: Iterable[dict],
    segments_for: Callable[[Any], list[dict]],
    tags_for: Callable[[Any], list[str]],
    collections_for: Callable[[Any], list[str]],
    manifest: dict[str, Any] | None = None,
) -> int:
    """Write the backup ZIP to `destination` one item at a time.

    `rows` is iterated lazily by the caller (keyset-paginated), and each item's
    segments are fetched, rendered and dropped before the next item is touched.
    Peak memory is therefore one item's segments plus the lightweight index rows,
    not the whole library.

    Returns the number of items written.
    """
    index_lines = ["# NEXUS library export", ""]
    light_rows: list[dict] = []
    count = 0

    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for row in rows:
            key = str(row["id"])
            segments = segments_for(row["id"])
            markdown = render_markdown(
                row,
                segments,
                tags=tags_for(row["id"]),
                collections=collections_for(row["id"]),
            )
            # Drop the segment bodies before touching the next item.
            del segments
            archive.writestr(
                f"items/{_safe_slug(row.get('title'))}-{key[:8]}.md", markdown
            )
            index_lines.append(f"- {row.get('title')} ({key})")
            light_rows.append(_light_row(row))
            count += 1

        archive.writestr("library.md", "\n".join(index_lines) + "\n")
        archive.writestr(
            "library.json",
            json.dumps(
                {
                    "nexus_backup": {
                        "version": 1,
                        "exported_at": datetime.now(timezone.utc).isoformat(),
                        "items": count,
                    },
                    "manifest": manifest or {},
                    "items": light_rows,
                },
                indent=2,
                ensure_ascii=False,
                default=str,
            ),
        )
        archive.writestr("README.txt", BACKUP_README)

    return count


def build_library_zip(
    items: list[dict],
    segments_by_item: dict[str, list[dict]] | None = None,
    *,
    tags_by_item: dict[str, list[str]] | None = None,
    collections_by_item: dict[str, list[str]] | None = None,
    manifest: dict[str, Any] | None = None,
) -> bytes:
    """In-memory convenience wrapper for tests and small libraries.

    Production export uses `write_library_zip` plus a StreamingResponse so a large
    library never has to fit in RAM.
    """
    segments = segments_by_item or {}
    tags = tags_by_item or {}
    collections_map = collections_by_item or {}

    with tempfile.TemporaryDirectory() as workdir:
        target = Path(workdir) / "library.zip"
        write_library_zip(
            target,
            rows=items,
            segments_for=lambda item_id: segments.get(str(item_id), []),
            tags_for=lambda item_id: tags.get(str(item_id), []),
            collections_for=lambda item_id: collections_map.get(str(item_id), []),
            manifest=manifest,
        )
        return target.read_bytes()


def segments_of(detail: dict) -> list[dict]:
    """Helper for callers that already have an ItemDetail."""
    segments: list[Segment] = detail.get("segments") or []
    return [segment.model_dump() if hasattr(segment, "model_dump") else dict(segment) for segment in segments]
