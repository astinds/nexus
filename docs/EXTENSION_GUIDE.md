# Extension Guide

Recipes for extending NEXUS with new extractors, storage adapters, export formats,
or workflow modules. Each recipe is self-contained and references the exact files
to touch.

---

## 1. Add a New Extractor (e.g., EPUB / YouTube / RSS)

### Files to add/modify
- `backend/app/extractors/<name>.py` — new extractor class
- `backend/app/extractors/__init__.py` — register it
- `backend/app/services/items.py` — import + wire into `INGEST_PIPELINE`

### Base contract (from `backend/app/extractors/base.py`)
```python
class BaseExtractor(ABC):
    source_format: str          # e.g. "epub", "youtube", "rss"
    mime_types: tuple[str, ...] # e.g. ("application/epub+zip",)

    @abstractmethod
    def extract(self, stream: BinaryIO, filename: str) -> ExtractedContent:
        ...

    @abstractmethod
    async def extract_async(self, stream: BinaryIO, filename: str) -> ExtractedContent:
        ...
```

`ExtractedContent` fields:
```python
@dataclass
class ExtractedContent:
    text_by_page: dict[int, str]   # page_number -> text (1-based)
    metadata: dict[str, Any]       # arbitrary metadata (author, duration, etc.)
    segments: list[ExtractedSegment]  # optional pre-segmented content
```

### Step-by-step: EPUB example
```python
# backend/app/extractors/epub.py
from ebooklib import epub
from bs4 import BeautifulSoup
from .base import BaseExtractor, ExtractedContent, ExtractedSegment

class EpubExtractor(BaseExtractor):
    source_format = "epub"
    mime_types = ("application/epub+zip",)

    def extract(self, stream: BinaryIO, filename: str) -> ExtractedContent:
        book = epub.read_epub(stream)
        text_by_page = {}
        segments = []
        page_num = 1

        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            soup = BeautifulSoup(item.get_content(), "html.parser")
            text = soup.get_text("\n", strip=True)
            if text:
                text_by_page[page_num] = text
                segments.append(ExtractedSegment(
                    segment_label=f"Chapter {page_num}",
                    content=text,
                    page_number=page_num,
                ))
                page_num += 1

        return ExtractedContent(
            text_by_page=text_by_page,
            metadata={"chapters": page_num - 1},
            segments=segments,
        )

    async def extract_async(self, stream: BinaryIO, filename: str) -> ExtractedContent:
        # CPU-bound, run in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.extract, stream, filename)
```

Register:
```python
# backend/app/extractors/__init__.py
from .epub import EpubExtractor
from .pdf import PdfExtractor
from .text import TextExtractor

EXTRACTORS = [PdfExtractor(), TextExtractor(), EpubExtractor()]
```

Wire into ingest (in `backend/app/services/items.py`):
```python
from app.extractors import EXTRACTORS

def get_extractor(fmt: str) -> BaseExtractor:
    for ext in EXTRACTORS:
        if ext.source_format == fmt or fmt in ext.mime_types:
            return ext
    raise ValueError(f"No extractor for {fmt}")
```

### Tests
- `backend/tests/test_extractors.py` — add test for new extractor using a fixture file

---

## 2. Add a Storage Adapter (e.g., Cloudflare R2 / S3 / Azure Blob)

### Files to add/modify
- `backend/app/storage/r2.py` — new adapter
- `backend/app/storage/__init__.py` — export it
- `backend/app/services/items.py` — use it when `STORAGE_BACKEND=r2`

### Base contract (from `backend/app/storage/base.py`)
```python
class StorageBackend(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str) -> str:
        """Store bytes, return the stored key (usually same as input)."""
        ...

    @abstractmethod
    def get(self, key: str) -> bytes:
        """Retrieve bytes; raise FileNotFoundError if missing."""
        ...

    @abstractmethod
    def delete(self, key: str) -> None:
        ...

    @abstractmethod
    def exists(self, key: str) -> bool:
        ...

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        """Return dict with 'healthy': bool, 'details': str."""
        ...
```

### Step-by-step: Cloudflare R2 example
```python
# backend/app/storage/r2.py
import boto3
from botocore.config import Config
from .base import StorageBackend

class R2Storage(StorageBackend):
    def __init__(self):
        self.s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT_URL"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4"),
        )
        self.bucket = os.environ["R2_BUCKET"]

    def put(self, key: str, data: bytes, content_type: str) -> str:
        self.s3.put_object(
            Bucket=self.bucket, Key=key, Body=data, ContentType=content_type
        )
        return key

    def get(self, key: str) -> bytes:
        resp = self.s3.get_object(Bucket=self.bucket, Key=key)
        return resp["Body"].read()

    def delete(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except self.s3.exceptions.ClientError as e:
            if e.response["Error"]["Code"] == "404":
                return False
            raise

    def health_check(self) -> dict[str, Any]:
        try:
            self.s3.head_bucket(Bucket=self.bucket)
            return {"healthy": True, "details": "R2 reachable"}
        except Exception as e:
            return {"healthy": False, "details": str(e)}
```

Register:
```python
# backend/app/storage/__init__.py
from .local import LocalStorage
from .supabase import SupabaseStorage
from .r2 import R2Storage

def get_storage() -> StorageBackend:
    backend = os.environ.get("STORAGE_BACKEND", "local").lower()
    if backend == "supabase":
        return SupabaseStorage()
    if backend == "r2":
        return R2Storage()
    return LocalStorage()
```

Required env vars (add to Render/`.env`):
```
STORAGE_BACKEND=r2
R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=nexus-files
```

---

## 3. Add an Export Format (e.g., DOCX / Anki / Obsidian)

### Files to add/modify
- `backend/app/export/<name>.py` — new exporter
- `backend/app/export/__init__.py` — register it
- `backend/app/routes/items.py` — add to format switch

### Base contract
```python
class BaseExporter(ABC):
    format_name: str          # e.g. "docx", "anki", "obsidian"
    content_type: str         # e.g. "application/vnd.openxmlformats..."
    extension: str            # e.g. ".docx"

    @abstractmethod
    def export(self, item: Item, segments: list[Segment], **kwargs) -> bytes:
        ...
```

### Step-by-step: Anki deck example
```python
# backend/app/export/anki.py
import genanki
from .base import BaseExporter

class AnkiExporter(BaseExporter):
    format_name = "anki"
    content_type = "application/octet-stream"
    extension = ".apkg"

    def export(self, item: Item, segments: list[Segment], **kwargs) -> bytes:
        model = genanki.Model(
            1607392319, "NEXUS Card",
            fields=[{"name": "Question"}, {"name": "Answer"}],
            templates=[{
                "name": "Card 1",
                "qfmt": "{{Question}}",
                "afmt": "{{FrontSide}}<hr id='answer'>{{Answer}}",
            }],
        )
        deck = genanki.Deck(2059400110, f"NEXUS: {item.title}")
        for seg in segments:
            # Create Q/A cards from segments
            note = genanki.Note(model=model, fields=[
                f"Segment: {seg.segment_label}",
                seg.content[:5000],  # truncate for Anki
            ])
            deck.add_note(note)

        pkg = genanki.Package(deck)
        buf = io.BytesIO()
        pkg.write_to_file(buf)
        return buf.getvalue()
```

Register:
```python
# backend/app/export/__init__.py
from .markdown import MarkdownExporter
from .json import JsonExporter
from .pdf import PdfExporter
from .anki import AnkiExporter

EXPORTERS = {
    "markdown": MarkdownExporter(),
    "json": JsonExporter(),
    "pdf": PdfExporter(),
    "anki": AnkiExporter(),
}

def get_exporter(fmt: str) -> BaseExporter:
    try:
        return EXPORTERS[fmt.lower()]
    except KeyError:
        raise ValueError(f"Unknown export format: {fmt}")
```

Route handler (in `backend/app/routes/items.py`):
```python
@router.get("/{item_id}/export")
async def export_item(item_id: str, format: str = "markdown", ...):
    exporter = get_exporter(format)
    data = exporter.export(item, segments)
    return StreamingResponse(
        io.BytesIO(data),
        media_type=exporter.content_type,
        headers={"Content-Disposition": f'attachment; filename="{item.id}{exporter.extension}"'}
    )
```

---

## 4. Add a Workflow Module (e.g., Daily Notes / Weekly Review)

### Architecture
Workflow modules are self-contained feature verticals that:
1. Define their own API routes under `/api/v1/workflows/<name>/`
2. Use existing services (items, search, collections) — no new tables unless necessary
3. Register in `backend/app/workflows/__init__.py`

### Files to add
- `backend/app/workflows/<name>/routes.py`
- `backend/app/workflows/<name>/service.py` (optional)
- `backend/app/workflows/__init__.py` — register router

### Step-by-step: Daily Notes example
```python
# backend/app/workflows/daily_notes/routes.py
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from datetime import date
from app.auth import require_access
from app.services.items import create_item

router = APIRouter(prefix="/daily-notes", tags=["daily-notes"])

class DailyNoteIn(BaseModel):
    content: str
    note_date: date | None = None

@router.post("")
async def create_daily_note(
    payload: DailyNoteIn,
    auth=Depends(require_access),
):
    note_date = payload.note_date or date.today()
    item = await create_item(
        workspace_id=auth.workspace_id,
        source_format="markdown",
        title=f"Daily Note — {note_date.isoformat()}",
        content=payload.content,
        blueprint_id="note",  # assumes a "note" blueprint exists
    )
    return {"item_id": item.id, "date": note_date.isoformat()}

@router.get("/{date_str}")
async def get_daily_note(date_str: str, auth=Depends(require_access)):
    # Search for item with title matching date
    ...
```

Register:
```python
# backend/app/workflows/__init__.py
from fastapi import APIRouter
from .daily_notes import router as daily_notes_router

workflow_router = APIRouter(prefix="/workflows", tags=["workflows"])
workflow_router.include_router(daily_notes_router)
```

Include in main app (`backend/app/main.py`):
```python
from app.workflows import workflow_router
app.include_router(workflow_router, prefix="/api/v1")
```

### Frontend integration
- Add page at `frontend/src/app/workflows/daily-notes/page.tsx`
- Use `useApi` hook to call `/api/v1/workflows/daily-notes/`

---

## 5. Key Invariants (never break these)

| Invariant | Where enforced |
|---|---|
| `item_segments.search_vector` is **generated**, never manually updated | DB schema (trigger) |
| SHA-256 dedup is per-workspace, unique | `items.sha256` unique index + `insert_item` |
| Passcode gate is **one dependency** (`require_access`) | `backend/app/auth.py` |
| Storage abstraction: only `put/get/delete/exists/health_check` | `backend/app/storage/base.py` |
| Extractors return `ExtractedContent` with `text_by_page` (1-based) | `backend/app/extractors/base.py` |
| Export formats are pure functions: `Item + Segments -> bytes` | `backend/app/export/base.py` |
| Frontend rewrites `/api/*` to backend — no CORS | `frontend/next.config.mjs` |

---

## 6. Testing new extensions

```bash
# Backend
cd nexus/backend
python3 -m pytest tests/ -k "extractor or storage or export" -v

# Frontend (if UI added)
cd nexus/frontend
npm run typecheck
npm run build
```

Add integration tests to `scripts/smoke_test.py` if the extension affects the
ingest/search/export flow.
