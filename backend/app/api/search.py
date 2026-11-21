"""Search and export routes."""

from __future__ import annotations

import tempfile
from pathlib import Path
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import StreamingResponse

from ..auth import require_access
from ..models import (
    ExportFormat,
    SearchResponse,
    SourceFormat,
    TriageStatus,
    clamp_limit,
    clamp_offset,
)
from ..repositories import collections as collections_repo
from ..repositories import items as items_repo
from ..repositories import tags as tags_repo
from ..repositories import activity
from ..services import export as export_service
from ..services import items as items_service
from ..services import search as search_service
from .deps import get_cursor

router = APIRouter(tags=["search", "export"], dependencies=[Depends(require_access)])


@router.get("/search", response_model=SearchResponse, summary="Full-text search across segments")
def search(
    q: str = Query(default="", description="Free text; websearch syntax (AND, OR, \"phrase\") works"),
    workspace_id: UUID | None = Query(default=None),
    source_format: SourceFormat | None = Query(default=None),
    blueprint_id: UUID | None = Query(default=None),
    triage_status: TriageStatus | None = Query(default=None),
    collection_id: UUID | None = Query(default=None),
    tag: str | None = Query(default=None),
    limit: int = Query(default=50),
    offset: int = Query(default=0),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> SearchResponse:
    return search_service.search(
        cur,
        q=q,
        workspace_id=workspace_id,
        source_format=source_format,
        blueprint_id=blueprint_id,
        triage_status=triage_status,
        collection_id=collection_id,
        tag=tag,
        limit=clamp_limit(limit),
        offset=clamp_offset(offset),
    )


def _author_headers(item: dict, filename: str, media_type: str) -> dict[str, str]:
    ascii_name = "".join(char if char.isascii() and (char.isalnum() or char in " ._-") else "_" for char in filename)
    return {
        "Content-Disposition": f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{filename}',
        "Content-Type": media_type,
    }


@router.get(
    "/items/{item_id}/export/{fmt}",
    summary="Export one item (markdown | json | bibtex | apa | mla)",
)
def export_item(
    item_id: UUID,
    fmt: ExportFormat,
    download: bool = Query(default=True, description="Attachment vs inline text"),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> Response:
    row = items_service.require_item(cur, item_id)
    segments = items_repo.list_segments(cur, item_id)
    item_tags = [tag["name"] for tag in tags_repo.for_item(cur, item_id)]
    item_collections = [entry["name"] for entry in collections_repo.for_item(cur, item_id)]

    body, media_type, filename = export_service.render(
        fmt, row, segments, tags=item_tags, collections=item_collections
    )
    activity.log(cur, "item.exported", f"Exported as {fmt.value}", item_id=item_id)
    headers = _author_headers(row, filename, media_type)
    if not download:
        headers["Content-Disposition"] = "inline"
    return Response(content=body, media_type=media_type, headers=headers)


def _iter_file(path: Path, chunk_size: int = 64 * 1024):
    """Yield bytes from disk, closing the handle when the client disconnects."""
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            yield chunk


@router.get("/export/library", summary="Full library backup as a streamed ZIP")
def export_library(
    workspace_id: UUID | None = Query(default=None),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> Response:
    """Stream a whole-library backup without ever holding it in RAM.

    One item at a time: fetch its lightweight row, its segments, its tags and
    collections; write the ZIP member; drop all four before the next item. Only
    the lightweight index rows (library.md / library.json) stay in memory.
    """
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    zip_path = Path(tmp.name)

    def _segments_for(item_id: UUID) -> list[dict]:
        return items_repo.list_segments(cur, item_id)

    def _tags_for(item_id: UUID) -> list[str]:
        return [tag["name"] for tag in tags_repo.for_item(cur, item_id)]

    def _collections_for(item_id: UUID) -> list[str]:
        return [entry["name"] for entry in collections_repo.for_item(cur, item_id)]

    try:
        count = export_service.write_library_zip(
            zip_path,
            rows=items_repo.iter_export_rows(cur, workspace_id=workspace_id),
            segments_for=_segments_for,
            tags_for=_tags_for,
            collections_for=_collections_for,
            manifest={"workspace_id": str(workspace_id) if workspace_id else None},
        )
        activity.log(cur, "library.exported", f"Library backup: {count} items")
    except Exception:
        zip_path.unlink(missing_ok=True)
        raise

    def _stream():
        try:
            yield from _iter_file(zip_path)
        finally:
            zip_path.unlink(missing_ok=True)

    return StreamingResponse(
        _stream(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="nexus-library.zip"'},
    )
