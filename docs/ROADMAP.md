# Roadmap — v1.1 and v1.2 Plug-in Specs

This is a living spec. Each feature is a **plug-in** — self-contained, optional,
and disable-able via feature flags. No feature rewrites the core schema.

---

## v1.1 — "Connect & Review" (Q1 target)

Four independent plug-ins. Each ships behind a `FEATURE_<NAME>=1` env var.

### 1.1 Highlights & Marginalia
**Goal.** Select text in any viewer (PDF, Markdown, Note) → save as a highlight with
optional note. Highlights are first-class searchable entities.

**Data model** (new table, no migration to existing tables):
```sql
CREATE TABLE highlights (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    segment_id uuid REFERENCES item_segments(id) ON DELETE SET NULL,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    range_start int NOT NULL,          -- char offset in segment.content
    range_end int NOT NULL,
    color varchar(7) DEFAULT '#fff37e', -- hex
    note text,                          -- optional marginalia
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
CREATE INDEX ON highlights(item_id);
CREATE INDEX ON highlights(workspace_id, created_at DESC);
```

**API:**
- `POST /api/v1/highlights` — create
- `GET /api/v1/items/{id}/highlights` — list for item
- `PATCH /api/v1/highlights/{id}` — update color/note
- `DELETE /api/v1/highlights/{id}`

**Search integration:** Highlights get their own `tsvector` column and appear in
unified search with a `type: "highlight"` discriminator.

**Frontend:** Highlight toolbar in `PdfViewer`, `MarkdownViewer`, `NoteEditor`.
Inline color picker (5 preset colors). Marginalia opens in the Inspector drawer.

---

### 1.2 SM-2 Flashcards
**Goal.** Turn any segment or highlight into a spaced-repetition card using the
SM-2 algorithm. Review queue lives in the app; no external Anki sync required.

**Data model:**
```sql
CREATE TABLE flashcards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    segment_id uuid REFERENCES item_segments(id) ON DELETE SET NULL,
    highlight_id uuid REFERENCES highlights(id) ON DELETE SET NULL,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    question text NOT NULL,
    answer text NOT NULL,
    -- SM-2 state
    ease_factor real DEFAULT 2.5,
    interval_days int DEFAULT 0,
    repetitions int DEFAULT 0,
    next_review date NOT NULL DEFAULT CURRENT_DATE,
    last_reviewed timestamptz,
    created_at timestamptz DEFAULT now()
);
CREATE INDEX ON flashcards(workspace_id, next_review) WHERE next_review <= CURRENT_DATE;
```

**API:**
- `POST /api/v1/flashcards` — create from segment/highlight or manual
- `GET /api/v1/flashcards/due` — cards due today (for review queue)
- `POST /api/v1/flashcards/{id}/review` — body: `{grade: 0..5}` → updates SM-2 state
- `GET /api/v1/flashcards/stats` — counts by state (new, learning, review)

**Frontend:** "Flashcards" tab in Library. Review mode: full-screen card, 4-grade
buttons (Again/Hard/Good/Easy). Keyboard shortcuts: 1/2/3/4.

---

### 1.3 Daily Notes
**Goal.** One Markdown note per day, auto-linked from the Dashboard. Quick capture
with `/daily` command in Omni-Capture.

**Data model:** Uses existing `items` with `blueprint_id = "daily-note"` (seeded).
No new tables.

**Features:**
- `GET /api/v1/workflows/daily-notes/{date}` — get or create
- `POST /api/v1/workflows/daily-notes` — append content
- Dashboard shows "Today's Note" card with word count, links to open
- Omni-Capture: `/daily` shortcut prefills today's note

**Frontend:** Calendar heatmap in Dashboard (GitHub-style). Click a day → open note.

---

### 1.4 Source-Linked Tasks
**Goal.** Create a task linked to an item/segment/highlight. Tasks are checkable,
filterable, and exportable.

**Data model:**
```sql
CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    title text NOT NULL,
    description text,
    status varchar(16) DEFAULT 'open', -- open, in_progress, done, cancelled
    priority int DEFAULT 0,            -- -1 low, 0 normal, 1 high, 2 urgent
    -- Source links (any combination, at least one)
    item_id uuid REFERENCES items(id) ON DELETE SET NULL,
    segment_id uuid REFERENCES item_segments(id) ON DELETE SET NULL,
    highlight_id uuid REFERENCES highlights(id) ON DELETE SET NULL,
    due_date date,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    completed_at timestamptz
);
CREATE INDEX ON tasks(workspace_id, status, due_date);
```

**API:**
- Full CRUD: `POST/GET/PATCH/DELETE /api/v1/tasks`
- `GET /api/v1/tasks?status=open&item_id=...` — filter
- `POST /api/v1/tasks/{id}/complete`

**Frontend:** Tasks panel in Inspector drawer (linked to current item). Global
"Tasks" page in Library with Kanban board (Open/In Progress/Done).

---

## v1.2 — "Ambient Intelligence" (Q2 target)

Five plug-ins. More ambitious — some need new dependencies or background workers.

### 2.1 Scoped Notebooks + Ambient Context
**Goal.** Group items into "Notebooks" (project-level containers). When you open a
notebook, the sidebar shows ambient context: related items, backlinks, recent
searches, suggested tags.

**Data model:**
```sql
CREATE TABLE notebooks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    title text NOT NULL,
    description text,
    color varchar(7),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE notebook_items (
    notebook_id uuid REFERENCES notebooks(id) ON DELETE CASCADE,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE,
    added_at timestamptz DEFAULT now(),
    PRIMARY KEY (notebook_id, item_id)
);
```

**Ambient context API:**
- `GET /api/v1/notebooks/{id}/context` → `{related_items, backlinks, recent_searches, suggested_tags}`
- Computed on-demand using `item_links`, `item_collections`, `item_tags`, search history

**Frontend:** Notebook selector in Shell header. Ambient sidebar panel (collapsible).

---

### 2.2 Auto-Routing Rules
**Goal.** "If ingested item matches X, apply Y" — e.g., PDFs with "invoice" → tag
`#finance`, collection `Receipts`, blueprint `Financial Doc`.

**Data model:**
```sql
CREATE TABLE routing_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    -- Match conditions (JSON, evaluated in order)
    conditions jsonb NOT NULL, -- e.g. {"source_format": "pdf", "content_contains": ["invoice", "receipt"]}
    -- Actions to apply
    actions jsonb NOT NULL,    -- e.g. {"tags": ["finance"], "collection_ids": ["uuid"], "blueprint_id": "uuid"}
    enabled boolean DEFAULT true,
    priority int DEFAULT 0,    -- higher runs first
    created_at timestamptz DEFAULT now()
);
```

**Execution:** Runs in `ingest` service after extraction, before returning `item_id`.
Rules are evaluated in priority order; first match wins (or all matches if
`continue_on_match: true`).

**Frontend:** Rules editor in Settings → "Auto-Routing". Visual builder + raw JSON.

---

### 2.3 Freshness Decay + Weekly Review
**Goal.** Items decay over time unless reviewed. Weekly Review queue surfaces stale
items. Inspired by Andy Matuschak's "orbit" and spaced repetition for knowledge.

**Data model:** Add to `items`:
```sql
ALTER TABLE items ADD COLUMN last_reviewed timestamptz;
ALTER TABLE items ADD COLUMN review_interval_days int DEFAULT 7;
ALTER TABLE items ADD COLUMN decay_factor real DEFAULT 1.0; -- multiplier per review
```

**Decay algorithm:**
```
staleness = (now() - last_reviewed) / review_interval_days
if staleness > 1.0: item is "stale"
if staleness > 3.0: item is "cold"
```
On review: `last_reviewed = now()`, `review_interval_days *= decay_factor` (default 1.3).

**API:**
- `GET /api/v1/review/weekly` — items stale/cold, paginated
- `POST /api/v1/items/{id}/review` — mark reviewed, updates interval

**Frontend:** "Weekly Review" page (Library tab). One item at a time, "Reviewed" /
"Snooze 1w" / "Archive" actions. Progress ring shows % reviewed this week.

---

### 2.4 YouTube / RSS / EPUB / ZIP Extractors
**Goal.** Capture more source types natively.

| Format | Library | Key capability |
|---|---|---|
| YouTube | `yt-dlp` + `whisper.cpp` (local) or `faster-whisper` | Download audio → transcribe → segments = transcript chunks with timestamps |
| RSS/Atom | `feedparser` | Fetch feed → each entry = segment with link back to source |
| EPUB | `ebooklib` + `BeautifulSoup` | Chapter-by-chapter extraction (see Extension Guide) |
| ZIP | `zipfile` | Recursively extract members, process each by its format |

**Implementation notes:**
- All new extractors go in `backend/app/extractors/` (see Extension Guide)
- YouTube transcription is heavy: run in background worker (`asyncio.to_thread`)
- Add `source_format` values: `youtube`, `rss`, `epub`, `zip`
- ZIP: max depth 3, skip `__MACOSX`, `.DS_Store`, files > 50 MB

**Frontend:** Capture tabs for each. YouTube: paste URL → "Transcribing…" state.

---

### 2.5 Client-Side Browser OCR (tesseract.js)
**Goal.** OCR scanned PDFs/images in the browser — no server GPU needed. Works
offline after first load (WASM cached).

**Architecture:**
- `frontend/src/lib/ocr.ts` — lazy-load `tesseract.js` via dynamic import
- Web Worker runs OCR (keeps main thread free)
- Progress callbacks update UI
- Result: text per page → sent to backend as `source_format: "ocr"` with
  `ocr_engine: "tesseract.js"` metadata

**Dependencies:**
```json
// frontend/package.json
"dependencies": {
  "tesseract.js": "^5.x",
  "pdfjs-dist": "^4.x"  // already present
}
```

**Frontend:** In Inspector drawer, "Run OCR" button on segments with `is_scanned`.
Shows progress bar. On complete, segment content updated, `is_scanned = false`,
search vector re-indexed.

**Privacy:** All processing local. Only final text sent to server.

---

### 2.6 Optional pgvector (semantic search)
**Goal.** Hybrid search: keyword (tsvector) + semantic (embeddings).

**Data model:**
```sql
-- Requires pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE item_segments ADD COLUMN embedding vector(768); -- nomic-embed-text dim
CREATE INDEX ON item_segments USING hnsw (embedding vector_cosine_ops);
```

**Pipeline:**
1. On ingest (or background job), embed each segment using `nomic-embed-text`
   (local via `sentence-transformers` or remote via Ollama/OpenAI)
2. Store in `embedding` column
3. Search API: if `?semantic=true`, combine keyword + vector scores (RRF or weighted)

**Frontend:** Search page toggle "Semantic". Results show both scores.

**Note:** Purely optional — adds ~2 GB model + vector index. Disable with
`FEATURE_PGVECTOR=0`.

---

## Feature Flag Matrix

| Feature | Env var | Default | Depends on |
|---|---|---|---|
| Highlights | `FEATURE_HIGHLIGHTS` | 0 | — |
| Flashcards | `FEATURE_FLASHCARDS` | 0 | Highlights |
| Daily Notes | `FEATURE_DAILY_NOTES` | 0 | — |
| Tasks | `FEATURE_TASKS` | 0 | — |
| Notebooks | `FEATURE_NOTEBOOKS` | 0 | — |
| Auto-Routing | `FEATURE_ROUTING` | 0 | — |
| Weekly Review | `FEATURE_WEEKLY_REVIEW` | 0 | — |
| YouTube/RSS/EPUB/ZIP | `FEATURE_EXTRACTORS_EXTENDED` | 0 | yt-dlp, whisper |
| Browser OCR | `FEATURE_BROWSER_OCR` | 0 | tesseract.js |
| pgvector | `FEATURE_PGVECTOR` | 0 | pgvector ext, embeddings |

All flags default **off** — zero risk to existing deployments.

---

## Implementation Order (suggested)

1. **Highlights** (foundation for Flashcards)
2. **Flashcards** (uses Highlights)
3. **Daily Notes** (standalone, high user value)
4. **Tasks** (standalone)
5. **Notebooks** (structural, enables Ambient Context)
6. **Auto-Routing** (power user feature)
7. **Weekly Review** (uses decay on items)
8. **Extended Extractors** (incremental: YouTube → RSS → EPUB → ZIP)
9. **Browser OCR** (frontend-only, impressive demo)
10. **pgvector** (heavy infra, last)
