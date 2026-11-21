# ROADMAP — v1.1 and v1.2

Written as plug-in specs, not wish lists: each item names the files to touch, the schema
change, and the acceptance check. v1.0's schema is designed so none of these require
breaking changes.

---

## v1.1 — Reading depth

### 1. Highlights & Marginalia

**Schema (new migration `004_highlights.sql`).**

```sql
create table if not exists highlights (
    id uuid primary key default gen_random_uuid(),
    item_id uuid not null references items(id) on delete cascade,
    segment_id uuid references item_segments(id) on delete cascade,
    quote text not null,
    char_start integer, char_end integer,
    note text,
    color text not null default 'amber',
    created_at timestamptz not null default now()
);
create index if not exists highlights_item_idx on highlights (item_id, created_at desc);
```

**Files.** `app/repositories/highlights.py`, `app/services/highlights.py`,
`app/api/highlights.py`; inspector selection toolbar in `frontend/components/inspector/`.
**Acceptance.** Select text in the segment reader -> POST highlight -> it survives reload,
appears in the item drawer, and is included in Markdown export as a blockquote under the
segment it belongs to.

### 2. SM-2 Flashcards

**Schema.** `flashcards (id, item_id, segment_id, front, back, ease real default 2.5,
interval_days integer default 0, repetitions integer default 0, due_at timestamptz,
created_at)`.
**Files.** `app/services/review.py` implementing SM-2 grading (0-5 quality ->
ease/interval/repetitions), `app/api/review.py` with `GET /review/due` and
`POST /review/{card_id}/grade`.
**Acceptance.** Grading "again" resets `repetitions` to 0 and sets `due_at` to now;
grading "easy" grows `interval_days` monotonically. Unit-tested against the published
SM-2 table.

### 3. Daily Notes

**Design.** A `note` item per day, title `YYYY-MM-DD`, linked to the previous day with
`relation_type = extends`. No new table: `items.metadata.daily = true` marks them.
**Files.** `app/services/daily.py` (get-or-create), `app/api/daily.py`,
`frontend/app/(app)/daily/page.tsx`.
**Acceptance.** Opening `/daily` twice a day returns the same item id; the second call
creates nothing.

### 4. Source-Linked Tasks

**Schema.** `tasks (id, item_id nullable, segment_id nullable, title, done boolean,
due_date date, created_at)`.
**Files.** `app/repositories/tasks.py`, `app/api/tasks.py`, a task block in the item
drawer. Tasks created while reading carry `item_id` + `segment_id`, so "why does this
task exist" is always answerable with a jump-back link.
**Acceptance.** A task created from Page 4 links back to Page 4 and opening it from the
task list scrolls the reader to that segment.

---

## v1.2 — Ambient intelligence (still $0)

### 1. Scoped Notebooks + Ambient Related-Segments Sidebar

**Schema.** `notebooks (id, workspace_id, name, description)`,
`notebook_items (notebook_id, item_id)`.
**Behaviour.** While reading item A inside notebook N, the sidebar ranks segments from
other items in N by lexical overlap (`ts_rank_cd`) and shared tags — no model, no cost.
**Files.** `app/services/related.py`, `GET /api/v1/items/{id}/related`.
**Acceptance.** The sidebar returns at most 5 segments, each with `item_title` and
`segment_label`, and never returns the current item.

### 2. Auto-Routing Rules

**Schema.** `routing_rules (id, name, priority, match jsonb, actions jsonb, enabled)`.
**Behaviour.** On ingest, rules are evaluated in priority order: match on
`source_format`, MIME, filename regex, URL host, word-count range; actions set
`blueprint_id`, `triage_status`, tags, collection.
**Files.** `app/services/routing.py`, called from `IngestService._persist`.
**Acceptance.** A rule matching `*.pdf` + host `arxiv.org` sets blueprint *Research Paper*
and tag `arxiv`; a rule with a bad regex is rejected at creation, not at ingest.

### 3. Freshness Decay + Weekly Review

**Design.** No schema change: decay is computed from `items.updated_at` and
`reading_progress`. A `GET /review/weekly` endpoint returns items whose
`processing_status = 'ready'` but untouched for 30+ days, grouped by collection.
**Files.** `app/services/freshness.py`, `frontend/app/(app)/review/page.tsx`.
**Acceptance.** An item updated yesterday is not listed; one untouched for 31 days is.

### 4. Additional Extractors

| Format | Library | Notes |
|---|---|---|
| YouTube | `yt-dlp` (subtitle track only) | caption text -> segments per cue block |
| RSS | `httpx` + `beautifulsoup4` | feed discovery, one item per entry |
| EPUB | `ebooklib` or stdlib `zipfile` + `lxml` | one segment per spine document |
| PPTX | `python-pptx` | one segment per slide, speaker notes appended |
| XLSX | `openpyxl` | one segment per row, header segment first |
| ZIP | stdlib `zipfile` | recurse supported members, one item per member |

Every one of these is a `BaseExtractor` subclass registered in
`app/extractors/__init__.py`; see `docs/EXTENSION_GUIDE.md`. No API change.

### 5. Client-Side Browser OCR (`tesseract.js`)

**Design.** Scanned PDF pages are rendered to canvas by `pdf.js`, OCR'd in the browser
(Web Worker, no server cost), and the result is POSTed back to
`PUT /api/v1/items/{id}/segments/{index}/ocr`, which fills `content` and flips
`is_scanned = false` with `metadata.ocr = 'tesseract.js'`.
**Why client-side.** Render Free has 512 MB and 15-minute spin-down; server OCR would
time out on a phone-sized budget.
**Acceptance.** A scanned page shows "OCR this page", the button fills the segment, and
search then finds text from that page.

### 6. Optional `pgvector` Semantic Search

**Schema (opt-in, off by default).**

```sql
create extension if not exists vector;
alter table item_segments add column if not exists embedding vector(1536);
create index if not exists item_segments_embedding_idx
    on item_segments using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

**Design.** Embeddings are produced by a user-supplied provider key (any OpenAI-compatible
endpoint) or a local model; when no provider is configured the column stays null and
search is purely lexical. `BaseSearchService` gains `semantic=` behind the same route.
**Acceptance.** With no provider: `/search` behaves exactly as in v1.0. With a provider:
the same query returns hybrid results and the response reports `mode: "hybrid"`.

---

## Explicit non-goals

- Multi-user accounts and sharing (v1.0's auth is deliberately single-user).
- Server-side OCR or embeddings on the free tier (memory and time limits).
- A mobile native app: the PWA + Share Target covers Android install.
- Real-time collaboration: incompatible with a 512 MB single instance.
