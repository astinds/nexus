"""Omni-Capture: file upload, pasted text, Markdown note, URL (Stage 4).

All three routes funnel into IngestService so capture behaviour stays identical
no matter how the item arrives.
"""

from __future__ import annotations

import tempfile
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from ..auth import require_access
from ..config import Settings, get_settings
from ..errors import ApiError
from ..models import IngestResult, IngestTextRequest, IngestUrlRequest, SourceFormat, TriageStatus
from ..services.ingest import IngestService
from .deps import get_cursor, get_ingest_service

router = APIRouter(tags=["ingest"], dependencies=[Depends(require_access)])

CHUNK = 1024 * 256  # 256 KB: bounded memory on a 512 MB host


def _uuid_or_none(value: str | None) -> UUID | None:
    if not value:
        return None
    try:
        return UUID(value)
    except ValueError:
        raise ApiError(422, "invalid_uuid", f"'{value}' is not a valid UUID")


def _spool_upload(upload: UploadFile, *, max_bytes: int) -> tuple[bytes, int]:
    """Read the upload into a temp file first, then into memory once verified.

    Streaming avoids holding the whole body plus a copy in RAM while the size
    check runs, which is what keeps Render Free inside 512 MB.
    """
    total = 0
    with tempfile.NamedTemporaryFile(delete=True) as spool:
        while chunk := upload.file.read(CHUNK):
            total += len(chunk)
            if total > max_bytes:
                raise ApiError(
                    413,
                    "file_too_large",
                    f"File is larger than the {max_bytes // (1024 * 1024)} MB limit.",
                    detail={"max_bytes": max_bytes},
                )
            spool.write(chunk)
        spool.flush()
        spool.seek(0)
        return spool.read(), total


@router.post(
    "/ingest",
    response_model=IngestResult,
    status_code=status.HTTP_201_CREATED,
    summary="Capture a file, pasted text or a Markdown note",
)
async def ingest(
    file: UploadFile | None = File(default=None, description="Any supported document"),
    text: str | None = Form(default=None, description="Pasted article, transcript or note body"),
    title: str | None = Form(default=None),
    source_format: str | None = Form(default=None),
    workspace_id: str | None = Form(default=None),
    blueprint_id: str | None = Form(default=None),
    triage_status: str | None = Form(default=None),
    tags: str | None = Form(default=None, description="Comma-separated tag names"),
    collection_ids: str | None = Form(default=None, description="Comma-separated UUIDs"),
    paste_fallback: bool = Form(default=False),
    cur: psycopg.Cursor = Depends(get_cursor),
    service: IngestService = Depends(get_ingest_service),
    settings: Settings = Depends(get_settings),
) -> IngestResult:
    tag_names = [name.strip() for name in (tags or "").split(",") if name.strip()]
    collection_uuids = [
        parsed for parsed in (_uuid_or_none(part.strip()) for part in (collection_ids or "").split(",")) if parsed
    ]
    triage = _triage(triage_status)

    if file is not None and file.filename:
        data, size = _spool_upload(file, max_bytes=settings.max_upload_bytes)
        explicit = _format(source_format)
        return service.ingest_file(
            cur,
            data=data,
            filename=file.filename,
            mime_type=file.content_type,
            workspace_id=_uuid_or_none(workspace_id),
            blueprint_id=_uuid_or_none(blueprint_id),
            title=title,
            triage_status=triage.value,
            tag_names=tag_names,
            collection_ids=collection_uuids,
            source_format=explicit,
        )

    if text and text.strip():
        payload = IngestTextRequest(
            text=text,
            title=title,
            source_format=_format(source_format) or SourceFormat.note,
            workspace_id=_uuid_or_none(workspace_id),
            blueprint_id=_uuid_or_none(blueprint_id),
            triage_status=triage,
            tags=tag_names,
            collection_ids=collection_uuids,
            is_paste_fallback=paste_fallback,
        )
        return service.ingest_text(cur, payload)

    raise ApiError(
        400,
        "nothing_to_ingest",
        "Send a file upload, or paste text. Both were empty.",
    )


@router.post(
    "/ingest/url",
    response_model=IngestResult,
    summary="Capture a web article by URL (arrives in Stage 4)",
)
def ingest_url(
    payload: IngestUrlRequest,
    cur: psycopg.Cursor = Depends(get_cursor),
    service: IngestService = Depends(get_ingest_service),
) -> IngestResult:
    return service.ingest_url(cur, payload)


@router.get("/ingest/formats", summary="Which source formats this deployment accepts")
def ingest_formats() -> dict:
    from ..extractors import available

    return {
        "formats": [fmt.value for fmt in SourceFormat],
        "extractors": available(),
        "file_only": ["pdf", "docx"],
        "paste_supported": ["markdown", "text", "csv", "json", "note", "web_article"],
    }


def _format(value: str | None) -> SourceFormat | None:
    if not value:
        return None
    try:
        return SourceFormat(value)
    except ValueError:
        raise ApiError(
            422,
            "invalid_source_format",
            f"'{value}' is not a supported source format.",
            detail={"allowed": [fmt.value for fmt in SourceFormat]},
        )


def _triage(value: str | None) -> TriageStatus:
    if not value:
        return TriageStatus.inbox
    try:
        return TriageStatus(value)
    except ValueError:
        raise ApiError(
            422,
            "invalid_triage_status",
            f"'{value}' is not a triage status.",
            detail={"allowed": [status.value for status in TriageStatus]},
        )
