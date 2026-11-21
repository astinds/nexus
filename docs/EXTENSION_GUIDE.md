# EXTENSION_GUIDE — copy-paste recipes

Four things get extended in NEXUS: extractors, storage backends, export formats and
workflow modules. Each recipe is self-contained and ends with the check that proves it
works.

Before you start: read `AGENTS.md` §4 (layering) and §5 (invariants). In particular,
segments are **1-based** and extraction must never hide a failure.

---

## 1. Add an extractor

Example: EPUB (one segment per spine document).

### Step 1 — the class

Create `backend/app/extractors/epub.py`:

```python
"""EPUB books: one segment per spine document."""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Any

from ..models.common import ProcessingStatus, SegmentStatus, SourceFormat
from ..text import humanize_title
from .base import BaseExtractor, ExtractionError, ExtractionResult, SegmentDraft
from .text import decode_text


class EpubExtractor(BaseExtractor):
    name = "epub"
    formats = (SourceFormat.text,)          # EPUB enters as a file, see Step 3
    mime_types = ("application/epub+zip",)
    extensions = (".epub",)

    def extract(
        self,
        *,
        data: bytes | None = None,
        text: str | None = None,
        filename: str | None = None,
        mime_type: str | None = None,
        hints: dict[str, Any] | None = None,
    ) -> ExtractionResult:
        if not data:
            raise ExtractionError("EPUB extraction needs the file bytes")

        import io

        segments: list[SegmentDraft] = []
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            documents = sorted(
                name for name in archive.namelist()
                if name.lower().endswith((".xhtml", ".html", ".htm"))
            )
            for index, name in enumerate(documents, start=1):   # 1-based, always
                markup = archive.read(name).decode("utf-8", errors="replace")
                body = decode_text(None, markup)                # or the HTML stripper
                segments.append(
                    SegmentDraft(
                        segment_index=index,
                        segment_label=f"Section {index}",
                        content=body,
                        extraction_status=(
                            SegmentStatus.ok if body.strip() else SegmentStatus.empty
                        ),
                        metadata={"href": name},
                    )
                )

        if not segments:
            raise ExtractionError("no readable documents inside the EPUB")

        return ExtractionResult(
            segments=segments,
            engine="epub-zipfile",
            title=humanize_title(filename) if filename else None,
            status=(
                ProcessingStatus.partial
                if any(s.extraction_status is SegmentStatus.empty for s in segments)
                else ProcessingStatus.ready
            ),
        )
```

**Rules the class must follow**

- `segment_index` starts at **1** and is contiguous.
- A page/section that produced no text is `SegmentStatus.empty`, not silently dropped.
- Only raise `ExtractionError` when the document is unusable as a whole.
- Set `engine` to a short, stable string; it lands in `items.metadata.engine`.
- Never call `pymupdf.open` without a `with` block (handles must close immediately).

### Step 2 — register it

`backend/app/extractors/__init__.py`:

```python
from .epub import EpubExtractor

registry.register(EpubExtractor())   # order matters: specific before generic
```

### Step 3 — make capture accept it

If the format needs a new `source_format`, add it in three places:

1. `backend/app/models/common.py` — `SourceFormat.epub = "epub"`.
2. `supabase/migrations/00X_epub_format.sql` — extend the CHECK constraint:
   ```sql
   alter table items drop constraint if exists items_source_format_check;
   alter table items add constraint items_source_format_check check (source_format in (
       'pdf','docx','markdown','text','csv','json','web_article','note','epub'
   ));
   ```
3. `backend/app/formats.py` — `".epub": SourceFormat.epub`.

If the format is a file container whose text cannot be pasted, also add it to
`FILE_ONLY_FORMATS` in `formats.py`, which makes `ingest_text` reject it with
`wrong_ingest_channel`.

### Step 4 — prove it

`backend/tests/test_extractors_epub.py`:

```python
def test_epub_segments_are_one_based(tmp_epub_bytes):
    result = EpubExtractor().extract(data=tmp_epub_bytes, filename="book.epub")
    assert [s.segment_index for s in result.segments] == list(
        range(1, len(result.segments) + 1)
    )
    assert result.engine == "epub-zipfile"
```

Then:

```bash
cd backend && python3 -m pytest && python3 -m pyflakes app tests
```

---

## 2. Add a storage backend

Example: an S3-compatible bucket.

Create `backend/app/storage/s3.py`:

```python
from ..storage.base import BaseStorage, StorageError, StoredObject, sanitize_key

SCHEME = "s3"


class S3Storage(BaseStorage):
    name = "s3"

    def __init__(self, endpoint: str, bucket: str, key_id: str, secret: str) -> None:
        self.endpoint, self.bucket = endpoint.rstrip("/"), sanitize_key(bucket)
        self._auth = (key_id, secret)

    def put(self, key: str, data: bytes, content_type: str | None = None) -> StoredObject:
        key = sanitize_key(key)
        # ...PUT self.endpoint/self.bucket/key...
        return StoredObject(uri=f"{SCHEME}://{self.bucket}/{key}", key=key,
                            size=len(data), content_type=content_type)

    def get(self, uri: str) -> bytes: ...
    def delete(self, uri: str) -> bool: ...
    def exists(self, uri: str) -> bool: ...
    def url_for(self, uri: str, *, expires_in: int = 3600) -> str | None: ...
```

Register it in `backend/app/storage/__init__.py::build_storage` and widen the validator
in `backend/app/config.py`:

```python
@field_validator("storage_backend")
@classmethod
def _known_backend(cls, value: str) -> str:
    allowed = {"local", "supabase", "s3"}
```

Add the new env vars to `.env.example`, and extend `Settings.warnings()` when the chosen
backend is missing its credentials.

**Tests** (`tests/test_storage.py`): round-trip put/get/exists/delete, traversal rejection
(`../`), wrong-scheme rejection, and `health()` returning `ok: False` when unreachable.

---

## 3. Add an export format

Example: CSL-JSON (Zotero import).

1. `backend/app/models/common.py` — add to `ExportFormat`: `csl_json = "csl-json"`.
2. `backend/app/services/export.py` — add a renderer:

```python
def render_csl_json(item: dict, segments: list[dict]) -> str:
    payload = {
        "id": str(item["id"]),
        "type": "document",
        "title": item["title"],
        "abstract": item.get("summary") or "",
        "note": item.get("source_uri") or "",
        "issued": {"date-parts": [[item["created_at"].year]]},
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)
```

3. Register it in the same module's `RENDERERS` dict:

```python
RENDERERS = {
    "markdown": render_markdown,
    "json": render_json,
    "bibtex": render_bibtex,
    "apa": render_apa,
    "mla": render_mla,
    "csl-json": render_csl_json,
}
```

4. The existing route picks it up with no change:
   `GET /api/v1/items/{id}/export/{fmt}`.

**Tests**: assert the output parses back (JSON), that Markdown starts with `---\n` and
contains `title:` exactly once, and that an item with no author still renders (no
`None` leaks into the file).

---

## 4. Add a workflow module

Example: a "reading queue" module.

A workflow module is a **service + router pair** with no new concepts:

1. `backend/app/repositories/queue.py` — SQL only, returns dicts.
2. `backend/app/services/queue.py` — rules; raise `ApiError` via `errors.py` helpers.
3. `backend/app/api/queue.py`:

```python
router = APIRouter(tags=["queue"], dependencies=[Depends(require_access)])


@router.get("/queue", response_model=Page[Item], summary="Items queued for reading")
def read_queue(
    limit: int = Query(default=50),
    offset: int = Query(default=0),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> Page[Item]:
    return queue_service.list_queue(cur, clamp_limit(limit), clamp_offset(offset))
```

4. Mount it in `backend/app/api/__init__.py`:

```python
from . import catalog, ingest, items, queue, studio, system
api_router.include_router(queue.router)
```

**Mounting gotcha:** every router except `system` must declare
`dependencies=[Depends(require_access)]`, or the endpoint will be public. Tests in
`test_auth_gate.py` will catch a missing guard only for endpoints they call, so add one
test per new public-looking route.

---

## Checklist before you commit

- [ ] `cd backend && python3 -m pytest` — all green
- [ ] `python3 -m pyflakes backend/app backend/tests scripts` — no output
- [ ] No file exceeds ~300 lines
- [ ] New migration is numbered and idempotent (`create table if not exists`, `on conflict do nothing`)
- [ ] New env var documented in `.env.example` and `Settings`
- [ ] `docs/PROJECT_STATE.md` updated (what changed, test output, next step)
- [ ] If a design changed: new ADR appended to `docs/DECISIONS.md`
