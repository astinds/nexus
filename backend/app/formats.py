"""Format mapping shared by ingest and the API layer.

One table decides which `source_format` a captured artefact becomes, so adding
an extension in one place updates every capture path.
"""

from __future__ import annotations

from .models.common import SourceFormat

EXTENSION_FORMATS: dict[str, SourceFormat] = {
    ".pdf": SourceFormat.pdf,
    ".docx": SourceFormat.docx,
    ".md": SourceFormat.markdown,
    ".markdown": SourceFormat.markdown,
    ".txt": SourceFormat.text,
    ".text": SourceFormat.text,
    ".csv": SourceFormat.csv,
    ".json": SourceFormat.json,
    ".html": SourceFormat.text,
    ".htm": SourceFormat.text,
}

MIME_FORMATS: dict[str, SourceFormat] = {
    "application/pdf": SourceFormat.pdf,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": SourceFormat.docx,
    "text/markdown": SourceFormat.markdown,
    "text/plain": SourceFormat.text,
    "text/csv": SourceFormat.csv,
    "application/json": SourceFormat.json,
    "text/html": SourceFormat.text,
}

# Formats that carry their content in the container, so pasted text cannot stand in.
FILE_ONLY_FORMATS: frozenset[SourceFormat] = frozenset({SourceFormat.pdf, SourceFormat.docx})


def format_from_filename(filename: str | None, mime_type: str | None) -> SourceFormat:
    """Best-effort source format; falls back to plain text, never to a guess."""
    lowered = (filename or "").lower()
    for extension, fmt in EXTENSION_FORMATS.items():
        if lowered.endswith(extension):
            return fmt
    if mime_type and mime_type in MIME_FORMATS:
        return MIME_FORMATS[mime_type]
    return SourceFormat.text
