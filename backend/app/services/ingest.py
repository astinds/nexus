"""Ingest orchestration: capture -> extract -> dedupe -> persist.

Zero mandatory fields. Every path ends with an item row and, when text exists,
searchable segments. Partial extraction is recorded, never hidden.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import psycopg

from ..errors import ApiError, bad_request, not_found, unprocessable
from ..extractors import ExtractionError, ExtractionResult, resolve
from ..extractors.web import WebArticleExtractor
from ..formats import FILE_ONLY_FORMATS, format_from_filename
from ..models import (
    IngestResult,
    IngestTextRequest,
    IngestUrlRequest,
    Item,
    SegmentIntegrity,
    SourceFormat,
)
from ..repositories import activity, collections, items, tags, workspaces
from ..storage import BaseStorage, StorageError
from ..text import humanize_title, read_minutes, sha256_bytes, sha256_text

log = logging.getLogger(__name__)


class IngestService:
    def __init__(
        self,
        storage: BaseStorage,
        *,
        max_upload_bytes: int,
        web_timeout_seconds: float = 20.0,
    ) -> None:
        self.storage = storage
        self.max_upload_bytes = max_upload_bytes
        self.web_timeout_seconds = web_timeout_seconds

    # ------------------------------------------------------------------ helpers
    def _resolve_workspace(self, cur: psycopg.Cursor, workspace_id: UUID | None) -> dict:
        if workspace_id is None:
            return workspaces.require_default(cur)
        row = workspaces.get(cur, workspace_id)
        if row is None:
            raise not_found("workspace", workspace_id)
        return row

    def _store_source(
        self, *, key_prefix: str, filename: str | None, data: bytes, mime_type: str | None
    ) -> str:
        key = f"{key_prefix}/source"
        if filename:
            key = f"{key_prefix}/{filename}"
        try:
            stored = self.storage.put(key, data, mime_type)
        except StorageError as exc:
            raise ApiError(502, "storage_error", "Could not persist the uploaded file.", detail=str(exc))
        return stored.uri

    def _find_duplicate(
        self, cur: psycopg.Cursor, workspace_id: UUID, content_hash: str
    ) -> dict | None:
        if not content_hash:
            return None
        return items.get_by_hash(cur, workspace_id, content_hash)

    def _persist(
        self,
        cur: psycopg.Cursor,
        *,
        workspace: dict,
        extraction: ExtractionResult,
        source_format: SourceFormat,
        title: str,
        source_uri: str | None,
        snapshot_uri: str | None,
        mime_type: str | None,
        file_size: int | None,
        content_hash: str,
        blueprint_id: UUID | None,
        triage_status: str,
        tag_names: list[str],
        collection_ids: list[UUID],
        custom_fields: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[dict, int]:
        word_count = extraction.word_count
        row = items.create(
            cur,
            {
                "workspace_id": workspace["id"],
                "blueprint_id": blueprint_id,
                "title": title[:500],
                "source_format": source_format.value,
                "source_uri": source_uri,
                "snapshot_uri": snapshot_uri,
                "mime_type": mime_type,
                "file_size": file_size,
                "word_count": word_count,
                "est_read_minutes": read_minutes(word_count),
                "content_hash": content_hash,
                "processing_status": extraction.status.value,
                "triage_status": triage_status,
                "error_message": "; ".join(extraction.warnings)[:2000] or None,
                "custom_fields": custom_fields or {},
                "metadata": {
                    **(metadata or {}),
                    "engine": extraction.engine,
                    "extraction": extraction.integrity_summary(),
                    **extraction.metadata,
                },
            },
        )
        created = items.insert_segments(
            cur, row["id"], [segment.as_row() for segment in extraction.segments]
        )
        if tag_names:
            tags.attach_names(cur, row["id"], tag_names)
        for collection_id in collection_ids:
            collections.attach(cur, row["id"], collection_id)
        activity.log(
            cur,
            "item.created",
            f"Captured {source_format.value} item: {title[:120]}",
            item_id=row["id"],
            metadata={
                "format": source_format.value,
                "engine": extraction.engine,
                "segments": created,
                "scanned": len(extraction.scanned_segments),
            },
        )
        return row, created

    def _run_extractor(
        self,
        *,
        source_format: SourceFormat,
        text: str | None,
        data: bytes | None,
        filename: str | None,
        mime_type: str | None,
    ) -> ExtractionResult:
        extractor = resolve(
            source_format=source_format, mime_type=mime_type, filename=filename
        )
        try:
            return extractor.extract(
                data=data, text=text, filename=filename, mime_type=mime_type
            )
        except ExtractionError as exc:
            raise unprocessable(f"Extraction failed: {exc}")
        except Exception as exc:  # never leak a stack trace to the client
            log.exception("extractor %s crashed", extractor.name)
            raise unprocessable(
                f"The {extractor.name} extractor could not read this document: {exc}"
            )

    # ------------------------------------------------------------------- public
    def ingest_text(self, cur: psycopg.Cursor, payload: IngestTextRequest) -> IngestResult:
        workspace = self._resolve_workspace(cur, payload.workspace_id)
        source_format = payload.source_format
        if source_format in FILE_ONLY_FORMATS:
            raise bad_request(
                f"{source_format.value} items need a file upload, not pasted text",
                code="wrong_ingest_channel",
            )

        content_hash = sha256_text(payload.text)
        duplicate = self._find_duplicate(cur, workspace["id"], content_hash)
        if duplicate is not None:
            return self._duplicate_result(cur, duplicate)

        extraction = self._run_extractor(
            source_format=source_format,
            text=payload.text,
            data=None,
            filename=payload.title,
            mime_type="text/markdown" if source_format == SourceFormat.note else None,
        )
        title = (payload.title or extraction.title or humanize_title("Untitled note")).strip()
        row, created = self._persist(
            cur,
            workspace=workspace,
            extraction=extraction,
            source_format=source_format,
            title=title,
            source_uri=payload.source_uri,
            snapshot_uri=None,
            mime_type="text/markdown" if source_format == SourceFormat.note else "text/plain",
            file_size=len(payload.text.encode("utf-8")),
            content_hash=content_hash,
            blueprint_id=payload.blueprint_id,
            triage_status=payload.triage_status.value,
            tag_names=payload.tags,
            collection_ids=payload.collection_ids,
            metadata={"ingest": "text", "paste_fallback": payload.is_paste_fallback},
        )
        return self._result(row, extraction, created, duplicate=False)

    def ingest_file(
        self,
        cur: psycopg.Cursor,
        *,
        data: bytes,
        filename: str,
        mime_type: str | None,
        workspace_id: UUID | None = None,
        blueprint_id: UUID | None = None,
        title: str | None = None,
        triage_status: str = "inbox",
        tag_names: list[str] | None = None,
        collection_ids: list[UUID] | None = None,
        source_format: SourceFormat | None = None,
    ) -> IngestResult:
        if not data:
            raise bad_request("the uploaded file is empty", code="empty_file")
        if len(data) > self.max_upload_bytes:
            raise ApiError(
                413,
                "file_too_large",
                f"File is larger than the {self.max_upload_bytes // (1024 * 1024)} MB limit.",
            )

        workspace = self._resolve_workspace(cur, workspace_id)
        fmt = source_format or format_from_filename(filename, mime_type)
        extraction = self._run_extractor(
            source_format=fmt, text=None, data=data, filename=filename, mime_type=mime_type
        )
        content_hash = sha256_bytes(data)
        duplicate = self._find_duplicate(cur, workspace["id"], content_hash)
        if duplicate is not None:
            return self._duplicate_result(cur, duplicate)

        key_prefix = f"{workspace['slug']}/{content_hash[:16]}"
        source_uri = self._store_source(
            key_prefix=key_prefix, filename=filename, data=data, mime_type=mime_type
        )
        resolved_title = (title or extraction.title or humanize_title(filename)).strip()
        row, created = self._persist(
            cur,
            workspace=workspace,
            extraction=extraction,
            source_format=fmt,
            title=resolved_title,
            source_uri=source_uri,
            snapshot_uri=None,
            mime_type=mime_type,
            file_size=len(data),
            content_hash=content_hash,
            blueprint_id=blueprint_id,
            triage_status=triage_status,
            tag_names=tag_names or [],
            collection_ids=collection_ids or [],
            metadata={"ingest": "file", "filename": filename, "sha256": content_hash},
        )
        return self._result(row, extraction, created, duplicate=False)

    def ingest_url(self, cur: psycopg.Cursor, payload: IngestUrlRequest) -> IngestResult:
        """Fetch, extract, keep an archival snapshot, then persist.

        The snapshot is the point: a dead link must not destroy the reference, so the
        raw HTML is stored next to the extracted text and linked as `snapshot_uri`.
        """
        workspace = self._resolve_workspace(cur, payload.workspace_id)
        try:
            raw_html, content_type = WebArticleExtractor.fetch(
                payload.url, timeout=self.web_timeout_seconds
            )
        except ExtractionError as exc:
            raise ApiError(
                502,
                "fetch_failed",
                str(exc),
                detail={"url": payload.url, "fallback": "POST /api/v1/ingest with text"},
            )

        extraction = self._run_extractor(
            source_format=SourceFormat.web_article,
            text=None,
            data=raw_html,
            filename=None,
            mime_type=content_type,
        )
        if payload.title:
            extraction.title = payload.title

        body_text = "\n\n".join(segment.content for segment in extraction.segments)
        content_hash = sha256_text(body_text)
        duplicate = self._find_duplicate(cur, workspace["id"], content_hash)
        if duplicate is not None:
            return self._duplicate_result(cur, duplicate)

        snapshot_uri = self._store_snapshot(
            workspace=workspace, content_hash=content_hash, raw=raw_html
        )
        title = (payload.title or extraction.title or humanize_title(payload.url)).strip()
        row, created = self._persist(
            cur,
            workspace=workspace,
            extraction=extraction,
            source_format=SourceFormat.web_article,
            title=title,
            source_uri=payload.url,
            snapshot_uri=snapshot_uri,
            mime_type="text/html",
            file_size=len(raw_html),
            content_hash=content_hash,
            blueprint_id=payload.blueprint_id,
            triage_status=payload.triage_status.value,
            tag_names=payload.tags,
            collection_ids=payload.collection_ids,
            metadata={"ingest": "url", "url": payload.url, "snapshot": True},
        )
        return self._result(row, extraction, created, duplicate=False)

    def _store_snapshot(self, *, workspace: dict, content_hash: str, raw: bytes) -> str | None:
        key = f"{workspace['slug']}/{content_hash[:16]}/snapshot.html"
        try:
            return self.storage.put(key, raw, "text/html").uri
        except StorageError as exc:
            # The item is still worth keeping; say so instead of failing the capture.
            log.warning("archival snapshot could not be stored: %s", exc)
            return None

    # -------------------------------------------------------------------- output
    @staticmethod
    def _result(
        row: dict, extraction: ExtractionResult, created: int, *, duplicate: bool
    ) -> IngestResult:
        return IngestResult(
            item=Item(**row),
            duplicate=duplicate,
            segments_created=created,
            warnings=extraction.warnings,
            engine=extraction.engine,
            integrity=SegmentIntegrity(**extraction.integrity_summary()),
        )

    @staticmethod
    def _duplicate_result(cur: psycopg.Cursor, row: dict) -> IngestResult:
        """Identical bytes in the same workspace: point at the existing item."""
        audit = items.integrity(cur, row["id"])
        return IngestResult(
            item=Item(**row),
            duplicate=True,
            segments_created=0,
            warnings=["Identical content already exists in this workspace."],
            engine=(row.get("metadata") or {}).get("engine"),
            integrity=SegmentIntegrity(**{**audit, "engine": None}),
        )
