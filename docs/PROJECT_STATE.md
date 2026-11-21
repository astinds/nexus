# PROJECT_STATE — living handoff sheet

Update this file at the end of **every** stage. A future model must be able to resume
from this page alone.

Last updated: Stage 3 complete (backend core).

---

## Stage status

| Stage | Scope | Status |
|---|---|---|
| 1 | Environment & wheel feasibility | ✅ complete |
| 2 | Architecture & contract blueprint | ✅ complete |
| 3 | Repo memory, schema, passcode gate, core backend | ✅ complete |
| 4 | Extractors, tsvector search, lossless export | ⬜ not started |
| 5 | Frontend core, PWA, mobile-safe inspector | ⬜ not started |
| 6 | Self-verifying smoke test & handoff docs | ⬜ not started |

---

## Stage 3 — what exists

### Schema (`supabase/migrations/`)

- `001_initial_schema.sql` — 14 tables: `schema_migrations`, `workspaces`,
  `metadata_blueprints`, `collections`, `tags`, `item_collections`, `item_tags`,
  `items`, `item_segments`, `relation_types`, `item_links`, `saved_views`,
  `prompt_templates`, `user_preferences`, `activity_logs`. Seeded: default workspace
  `personal`, 7 relation types, 3 prompt templates, preferences singleton.
  `item_segments.search_vector` is a **generated** `tsvector` column with a GIN index,
  so it can never drift from `content`.
- `002_updated_at_triggers.sql` — `nexus_touch_updated_at()` attached where the column exists.
- `003_collection_tree.sql` — `nexus_collection_tree(uuid)` for nested collection filters.

### Backend (`backend/app/`)

- **Auth** (`auth.py`): passcode gate, `X-Nexus-Key` header or `nexus_session` cookie
  (HMAC of a label keyed by the passcode), `require_access` dependency, open dev mode.
- **API** (36 paths under `/api/v1`, `docs/` PAGES: see `/docs`):
  `health`, `meta`, `auth/session` (GET/POST/DELETE), workspaces, blueprints,
  collections (+`/tree`), tags (+`/merge`), relation-types, items (+detail, triage,
  progress, content, links, segments, download), saved-views (+pin), prompt-templates,
  prompt-context, preferences, dashboard, activity, ingest (+`/ingest/url`,
  `/ingest/formats`).
- **Services**: `ingest.py` (dedupe by SHA-256, extraction, persistence),
  `items.py` (detail assembly, triage, progress, note re-index, links),
  `catalog.py` (workspaces, blueprints, collections, tags+merge, relation types),
  `studio.py` (smart lenses, prompts, preferences).
- **Repositories**: `base.py` (Query builder, whitelisted `order_by`, helpers),
  `items.py`, `tags.py`, `collections.py`, `workspaces.py`, `blueprints.py`,
  `relations.py`, `studio.py`, `activity.py`.
- **Extractors**: `base.py` (contract + registry), `text.py`
  (`TextStructuredExtractor`: md/txt/html/csv/json), `note.py` (`NativeNoteExtractor`).
- **Storage**: `base.py` (contract), `local.py`, `supabase.py` (raw httpx REST,
  signed URLs, private bucket).

### Tests — 81 passing, no database required

```
$ cd backend && python3 -m pytest
81 passed, 1 warning in 3.36s
```

Coverage by file: `test_text_utils.py` (12), `test_models.py` (14),
`test_auth_gate.py` (11), `test_storage.py` (13), `test_extractors_text.py` (14),
`test_migrations_sql.py` (12), `test_repositories_sql.py` (11, approximate split).

Lint:

```
$ python3 -m pyflakes backend/app backend/tests scripts
(no output)
```

---

## Active caveats and fallbacks (read before Stage 4)

### 1. No PostgreSQL server available on this device

`initdb` (PostgreSQL 18.7 from the Termux repo) hangs at:
`selecting default "max_connections" ...` and never returns. Tried: foreground and
background, `--no-sync`, `-c max_connections=100 -c shared_buffers=32MB`, and a fresh
data directory. The `postgres -C` probe it runs never completes on this kernel.

Consequences:
- Migrations are **statically validated** (`tests/test_migrations_sql.py` parses every
  statement with sqlglot and asserts tables/columns/indexes/seeds) but have **not been
  executed** against a live server yet.
- Repository SQL is tested through the query builders, not against real tables.
- `scripts/apply_migrations.py` is written and dry-run verified; it needs a real
  `DATABASE_URL` (Supabase) to be proven.

**Before Stage 4 or at the start of deployment:** run
`DATABASE_URL=... python scripts/apply_migrations.py` once and paste the output into
this file.

### 2. PyMuPDF cannot load on this device

```
ImportError: dlopen failed: cannot locate symbol "_ZNSt6__ndk113__hash_memoryEPKvm"
referenced by ".../lib/libtesseract.so"
```

`libmupdf.so` links `libtesseract.so`, which was built against a newer NDK `libc++`
than the installed `libc++ (30)`. The `tesseract` CLI is broken for the same reason.
Mitigations already in place:
- `python-pymupdf` remains installed for a future libc++ upgrade.
- `pypdf` is installed and usable.
- Stage 4's `PdfExtractor` must try `pymupdf` first and fall back to `pypdf`, recording
  the engine actually used in `ExtractionResult.engine` and in item metadata.

Do not "fix" this by hand-patching libraries or prepending `LD_LIBRARY_PATH`.

### 3. ICU mismatch workaround (dev only, not committed)

PostgreSQL 18 needs `libicui18n.so.79`; the prefix ships 78.3. A copy of `libicu 79.1`
was extracted to `.harness-scratch` purely to let `postgres --version` run. It is not
part of the repo and not required by the app.

### 4. Python 3.14 / pip specifics

- `python3 -m venv` fails (`ensurepip` wheel missing). Dependencies are installed into
  the prefix with `pip --only-binary=:all: --extra-index-url
  https://termux-user-repository.github.io/pypi/`.
- `psycopg[binary]` does not exist for bionic; plain `psycopg` 3.3.9 + `libpq` is used.
  Same API, so no code difference versus production.

---

## Installed and verified in this environment

| Package | Version | Notes |
|---|---|---|
| fastapi | 0.165.0 | works |
| starlette | 1.10.0 | routes nest as `_IncludedRouter`; `app.openapi()` fine |
| pydantic | 2.14.3 | pydantic-core 2.50.4 (android_24_arm64_v8a wheel) |
| uvicorn | 0.54.0 | |
| httpx | 0.28.1 | |
| psycopg | 3.3.9 | pure-Python impl + libpq |
| pg8000 | 1.31.6 | unused fallback |
| beautifulsoup4 / lxml / trafilatura | 4.15.0 / 6.1.1 / 0.7.0 | |
| python-docx | 1.2.0 | |
| pypdf | 7.1.1 | PDF fallback |
| sqlglot | 30.33.0 | migration parsing in tests |
| pytest / pytest-asyncio | 9.2.0 / 1.5.0 | |
| pymupdf | installed | **cannot import** (libtesseract symbol) |

---

## Next exact step

Stage 4, in this order:

1. `backend/app/extractors/pdf.py` — `PdfExtractor`: `import pymupdf` inside a
   `try/except ImportError`, `with pymupdf.open(...)`, 1-based pages, per-page
   `is_scanned` (page has no text but has images), `extraction_status`, `engine` field
   reporting `pymupdf` or `pypdf`; close handles immediately.
2. `backend/app/extractors/docx.py` — headings -> segments via `python-docx`.
3. `backend/app/extractors/web.py` — `httpx` + `trafilatura` (BeautifulSoup fallback),
   archival snapshot to storage, `ingest_url` replaces its current 501.
4. `backend/app/services/search.py` + `/api/v1/search` — `websearch_to_tsquery`,
   `ts_headline` snippets, facet counts, filters.
5. `backend/app/services/export.py` + routes — Markdown+YAML, JSON, BibTeX/APA/MLA,
   full-library backup ZIP.
6. Register the new extractors in `app/extractors/__init__.py`; extend tests; rerun
   pytest and pyflakes; update this file.

---

## Environment variables actually required

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (deploy) | PostgreSQL / Supabase |
| `NEXUS_ACCESS_KEY` | yes (deploy) | passcode gate; empty = open dev |
| `STORAGE_BACKEND` | no | `local` (default) or `supabase` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` | when `supabase` | storage |
| `MAX_UPLOAD_MB` | no | default 25 |
| `CORS_ORIGINS` | no | unnecessary with the Next.js proxy |
| `COOKIE_SECURE` | production | `true` behind HTTPS |
