# PROJECT_STATE — living handoff sheet

Update this file at the end of **every** stage. A future model must be able to resume
from this page alone.

Last updated: Stage 6.2 Phase 1 complete (CI & cold-start resilience).
Repository: https://github.com/astinds/nexus (branch `main`)
Stage 5A commit: `a51ed8a`
Stage 5B commit: `94d4f1c`
Stage 6 commit: `31216b0`
Stage 6.1 commit: `c4de5de` (pre-deploy patch), CI fixes: `95dafe4`, `e9079cd`, `fc7dcce`

## Live database — APPLIED

Migrations were applied to Supabase (`aws-1-ap-southeast-2` pooler) on 2026-11-22
and verified:

| Check | Result |
|---|---|
| `apply_migrations.py` | `3 migration(s) applied`; rerun → `applied: 3 pending: 0` |
| Tables | 15/15 present |
| `item_segments_search_idx` | `USING gin (search_vector)` |
| Seeds | workspaces 1, relation_types 7, prompt_templates 3, preferences 1 |
| Functions | `nexus_touch_updated_at`, `nexus_collection_tree` |
| `schema_migrations` | 3 rows, checksums match the files |

**Two runner bugs were found by finally running it against a real server** (it had
never executed end-to-end before):

1. The `.sql` files carry their own `begin; … commit;`. Executing them inside the
   runner's `conn.transaction()` let the file's COMMIT end the outer transaction and
   destroy psycopg's savepoint — `InvalidSavepointSpecification: savepoint "_pg3_1"
   does not exist`. Those two lines are now stripped (dollar-quote aware, so plpgsql
   bodies keep theirs).
2. DDL applied but `schema_migrations` stayed empty: the read query left an implicit
   transaction open, so each file's block was only a `SAVEPOINT` and `conn.close()`
   rolled everything back. `conn.commit()` now runs after the read and after each
   file.

Both are pinned by `backend/tests/test_apply_migrations.py` (4 tests, no DB needed).

## CI status (verified on GitHub, not assumed)

| Workflow | Run | Result |
|---|---|---|
| `ci.yml` | #4 on `fc7dcce` | ✅ success, 50 s (backend 19 s, frontend 46 s) |
| `keep-alive.yml` | #3 on `fc7dcce` (workflow_dispatch) | ✅ success, skipped cleanly — `NEXUS_HEALTH_URL` not set |

The Linux CI run proves native-SWC `next build` health: `NEXUS_SWC_WASM=0` is set in the
frontend job, so `scripts/next.mjs` skips the WASM preload and Next uses
`@next/swc-linux-x64-gnu`.

---

## Stage status

| Stage | Scope | Status |
|---|---|---|
| 1 | Environment & wheel feasibility | ✅ complete |
| 2 | Architecture & contract blueprint | ✅ complete |
| 3 | Repo memory, schema, passcode gate, core backend | ✅ complete |
| 4 | Extractors, tsvector search, lossless export | ✅ complete |
| 5A | Frontend core: shell, dashboard, library, search, omni-capture, theme, auth | ✅ complete |
| 5B | Inspector, Collections/Tags, Studio, Settings, PWA share target | ✅ complete |
| 6 | Self-verifying smoke test & handoff docs | ✅ complete |
| 6.2 P1 | CI & cold-start resilience (keep-alive, CORS, fetch timeouts/retry) | ✅ complete |

---

## Stage 6.2 — Hardening & Testing Pass

### Phase 1 — CI & Cold-Start Resilience ✅

**Audit findings**

- `keep-alive.yml` failed on every push because `if: ${{ secrets.X != '' }}` is illegal
  at job level (the `secrets` context is unavailable there). Already fixed before this
  phase; it now skips cleanly via an env-var output check.
- It still lacked a job timeout, and plain `--retry` does not retry the HTTP 5xx that
  Render returns while booting.
- Backend CI on `main` was **already green** (runs on `4f602db`, `e026969`, `f74a599`).
- `CORS_ORIGINS=*` was accepted silently. With `allow_credentials=True` Starlette echoes
  `*`, which browsers reject for credentialed requests — a production footgun with no
  visible symptom until the session cookie stops working.
- The frontend `fetch` had **no timeout and no retry**, so a 45 s Render wake-up hung the
  UI and a single flaky attempt showed as an outage.

**Changes**

| File | Change |
|---|---|
| `.github/workflows/keep-alive.yml` | `timeout-minutes: 8`; `--max-time 60 --retry 3 --retry-all-errors --retry-delay 15`; documents the 60-day schedule-disable rule |
| `backend/app/config.py` | `cors_origin_list` drops bare `*`; new `cors_wildcard_requested`; `warnings()` explains the drop |
| `backend/tests/test_cors_health.py` | 7 tests: health shape, health public while locked, allowed-origin preflight, unlisted origin gets no ACAO, wildcard dropped, wildcard warned, explicit list unwarned |
| `frontend/src/lib/api.ts` | `AbortController` budgets — 120 s `/ingest`, 60 s `/health`, 30 s default; `timeout_error` distinct from `network_error`; one retry limited to idempotent `GET` on status 0 or 5xx |
| `frontend/src/lib/useHealth.ts` | Banner at ~3 s (`waking`), re-probes every 3 s, only flips to `unreachable` after the full 60 s window |

**Verification**

```
pytest                       147 passed
pyflakes backend/app backend/tests scripts    exit 0, no output
npm run typecheck            exit 0
npm run build                exit 0 — 10 routes, 84.5 kB shared
```

**Known follow-up (v1.1, deliberately not patched)**

`002_updated_at_triggers.sql` attaches `nexus_touch_updated_at` only to the tables in
its array — `items`, `collections`, `workspaces`, `metadata_blueprints` — so
`user_preferences.updated_at` is never maintained by a trigger. Its checksum is already
locked in `schema_migrations`, so editing it in place is refused by design; fix it with a
new `004_` migration in v1.1.

---

## Stage 3 — what exists

### Schema (`supabase/migrations/`)

- `001_initial_schema.sql` — 15 tables: `schema_migrations`, `workspaces`,
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
- **API** (39 paths under `/api/v1`): `health`, `meta`, `auth/session` (GET/POST/DELETE),
  workspaces, blueprints, collections (+`/tree`), tags (+`/merge`), relation-types,
  items (+detail, triage, progress, content, links, segments, download), saved-views
  (+pin), prompt-templates, prompt-context, preferences, dashboard, activity, ingest
  (+`/ingest/url`, `/ingest/formats`), search, export (+`/export/library`).
- **Services**: `ingest.py` (dedupe by SHA-256, extraction, persistence, URL fetch with
  archival snapshot), `items.py` (detail assembly, triage, progress, note re-index,
  links), `catalog.py` (workspaces, blueprints, collections, tags+merge, relation types),
  `studio.py` (smart lenses, prompts, preferences), `search.py` (PostgreSQL full-text via
  `websearch_to_tsquery` + `ts_headline`, facet counts), `export.py` (Markdown+YAML,
  JSON, BibTeX/APA/MLA, full-library backup ZIP).
- **Repositories**: `base.py` (Query builder, whitelisted `order_by`, helpers),
  `items.py`, `tags.py`, `collections.py`, `workspaces.py`, `blueprints.py`,
  `relations.py`, `studio.py`, `activity.py`.
- **Extractors**: `base.py` (contract + registry), `text.py`
  (`TextStructuredExtractor`: md/txt/html/csv/json), `note.py` (`NativeNoteExtractor`),
  `pdf.py` (`PdfExtractor`: PyMuPDF primary → pypdf fallback; 1-based pages; vector-only
  pages flagged scanned via `page.get_contents().get_data()` bytes check; per-page
  `extraction_status` with `failed` for errors; `engine` field reports actual engine),
  `docx.py` (`DocxExtractor`: heading sections + tables as pipe-separated rows; synthetic
  preamble section dropped when document opens with a heading), `web.py`
  (`WebArticleExtractor`: trafilatura → BeautifulSoup → text; archival snapshot via
  `ExtractionResult.archival`; manual paste fallback via `_from_text`;
  `WebArticleExtractor.fetch()` with timeout, headers, status handling; MAX_HTML_BYTES
  guard; honest error messages directing to manual paste fallback).
- **Storage**: `base.py` (contract), `local.py`, `supabase.py` (raw httpx REST,
  signed URLs, private bucket).

### Tests — 130 passing, no database required

```
$ cd backend && python3 -m pytest
130 passed, 1 warning in 11s
```

Coverage by file (approximate): `test_text_utils.py` (12), `test_models.py` (14),
`test_auth_gate.py` (11), `test_storage.py` (13), `test_extractors_text.py` (14),
`test_extractors_pdf.py` (10), `test_extractors_docx.py` (8), `test_extractors_web.py` (12),
`test_migrations_sql.py` (12), `test_repositories_sql.py` (10), `test_export.py` (19),
`test_search_sql.py` (8).

Lint:

```
$ python3 -m pyflakes backend/app backend/tests scripts
(no output)
```

---

## Stage 5A — Frontend Core Shell, Capture, Library & Search

### What was built (Stage 5A)

- **Next.js 14 App Router** with TypeScript strict mode, Tailwind CSS driven by CSS custom properties
- **Typed API client** (`src/lib/types.ts` + `src/lib/api.ts`) matching FastAPI `/api/v1` schemas exactly
- **Theme engine** (`src/lib/useTheme.ts`): live CSS custom properties (`--bg`, `--surface`,
  `--accent`, `--font-reading`, `--reading-width`, `--font-scale`) initialized from `GET /api/v1/preferences`
  with clean dark defaults; supports runtime updates and persists to backend
- **Cold-start wake + health** (`src/lib/useHealth.ts` + `src/components/WakeBanner.tsx`):
  calm "Waking up NEXUS engine…" banner with retry when health/session is waking/unreachable/degraded
- **Passcode gate** (`src/components/PasscodeGate.tsx`): wired to `/api/v1/auth/session`;
  auto-bypassed when backend reports open dev mode
- **Responsive minimalist dark shell** (`src/components/Shell.tsx`): mobile-first bottom nav +
  desktop sidebar, workspace switcher, pinned smart lenses, `Cmd/Ctrl+K` quick search, persistent
  Omni-Capture trigger
- **Dashboard** (`/`): totals by format/blueprint/triage, Inbox count, Continue Reading, Recently Added,
  Recent Activity, Quick Capture, Search bar
- **Omni-Capture Modal** (`src/components/OmniCaptureModal.tsx`): Upload File (PDF/DOCX/MD/TXT/HTML/CSV/JSON
  with size validation), Clip URL with Paste Article fallback tab, New Markdown Note (`POST /api/v1/items`)
- **Library** (`/library`): Table/Cards toggle, filters for Format/Blueprint/Triage/Time Budget/
  Collection/Tag, pagination, "Save as Smart Lens" (`POST /api/v1/saved-views`)
- **Search** (`/search`): multi-faceted full-text search wired to `GET /api/v1/search` with
  `ts_headline` snippets linking to `/items/[id]`
- **Item placeholder** (`/items/[id]`): minimal stub for Stage 5B inspector

### Verification

```
$ cd nexus/frontend && node node_modules/typescript/bin/tsc --noEmit
(no output — exit 0)
```

### Known limitation

- **Next.js production build**: native SWC build fails on ARM64 Android because `@next/swc-android-arm64`
  is not published to npm (404). The WASM workaround is now opt-in via `NEXUS_SWC_WASM=1`
  (`experimental.useWasmBinary` + `webpackBuildWorker: false`) so Linux/Vercel builds keep
  native SWC. On this device `next build` still stops at the native download step, so the
  frontend is verified with `tsc --noEmit` and a Tailwind CLI compile.

---

## Stage 5B — Inspector, Collections/Tags, Studio, Settings & PWA

### Hardening carried in from Stage 5A review

- `next.config.mjs`: `experimental.useWasmBinary` / `webpackBuildWorker` are gated behind
  `NEXUS_SWC_WASM=1`; `rewrites()` is always configured.
- Search snippets: `HighlightedSnippet` splits `ts_headline` output on `<b>`/`</b>` and
  renders React text nodes. No `dangerouslySetInnerHTML` remains (ADR-015).

### What was built (Stage 5B)

- **Item Inspector** (`/items/[id]`):
  - `PdfViewer` — `pdfjs-dist` imported dynamically inside `useEffect` (SSR-safe), worker
    served from `public/pdf.worker.min.mjs`, fit-to-width via `ResizeObserver`, page
    navigation, `?segment=`/`?page=` jump, direct Open/Download link.
  - `SegmentReader` — labelled segment list for DOCX/Markdown/CSV/JSON/web clips, with
    per-segment scanned/failed badges.
  - `IntegrityBanner` — explicit audit whenever pages are `is_scanned` or `failed`, with
    jump-to-page buttons.
  - `NoteEditor` — inline Markdown edit via `PUT /api/v1/items/{id}/content` (re-indexes).
  - Reading progress — `POST /api/v1/items/{id}/progress` on page/segment change, so the
    Dashboard "Continue reading" resumes exactly.
  - `InspectorDrawer` — triage, collections + tags, prompt-with-context copy, lossless
    export (Markdown+JSON+BibTeX+APA+MLA), original file, delete with confirmation.
  - `BlueprintPanel` — blueprint selector plus a typed custom-field form driven by
    `fields_schema` (text/number/date/select/boolean/url).
  - `LinkPanel` — typed links with relation type, note, item search, and removal.
- **Collections & Tags** (`/collections`): nested tree with PARA typing, rename, re-parent,
  delete; tag manager with rename, aliases, one-click merge (`POST /api/v1/tags/merge`).
- **Studio** (`/studio`): tabbed Workspaces, Blueprints (visual field-schema editor),
  Relation Types, Prompt Templates.
- **Settings** (`/settings`): live appearance customizer (font family, palette, accent,
  reading width, font scale, density) persisted to `PATCH /api/v1/preferences`; system
  health + extractor engine status; one-click library backup ZIP; API reference snippet.
- **PWA**: `public/manifest.json` (standalone, dark theme, maskable icons),
  `public/icons/icon-192.png` + `icon-512.png` generated by
  `.harness/scripts/make_icons.py` (stdlib only), metadata in `layout.tsx`, and a
  `share_target` (`GET /capture?title&text&url`) implemented in `/capture` for one-tap
  capture from Android shares.

### Backend change required by Stage 5B

`ItemUpdate` gained optional `tags` and `collection_ids` (replace semantics) so the
inspector can re-file an item after capture (ADR-016). Covered by two new model tests.

### Verification

```
$ cd nexus/frontend && npm run typecheck                               # exit 0
$ cd nexus/frontend && npm run build                                   # 10 routes, 84.5 kB shared
$ cd nexus/backend  && python3 -m pytest -q                            # 132 passed
$ node node_modules/tailwindcss/lib/cli.js -c tailwind.config.js \
      -i src/app/globals.css -o <tmp>                                  # 25.7 KB built
```

`npm run build` now runs to completion on this ARM64 device (ADR-017 supersedes the
ADR-013 caveat): the scripts preload the WASM SWC bindings and run the Next workers as
threads. Build output:

```
Route (app)                              Size     First Load JS
┌ ○ /                                    1.95 kB        98.5 kB
├ ○ /_not-found                          885 B          85.3 kB
├ ○ /capture                             1.5 kB           98 kB
├ ○ /collections                         2.64 kB        99.2 kB
├ λ /items/[id]                          6.96 kB         103 kB
├ ○ /library                             2.83 kB        99.4 kB
├ ○ /search                              2.45 kB          99 kB
├ ○ /settings                            3.1 kB         99.6 kB
└ ○ /studio                              3.38 kB        99.9 kB
```

---

## Active caveats and fallbacks (read before Stage 5)

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

**Before Stage 5 or at the start of deployment:** run
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
- `PdfExtractor` tries `pymupdf` first and falls back to `pypdf`, recording
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

**Go live.** The repo is pushed and CI is green; the remaining steps need the owner's
Supabase / Render / Vercel accounts:

1. Supabase: Shared Pooler **Session mode** (port 5432, IPv4) URI + `?sslmode=require`,
   then `DATABASE_URL="..." python3 scripts/apply_migrations.py`, then a **private**
   bucket `nexus-files`.
2. Render: Blueprint from `render.yaml`, fill the `sync: false` secrets, wait for
   `/api/v1/health` → `status: ok`.
3. Vercel: root directory `frontend`, `API_BACKEND_URL=<render url>`.
4. Proof: `python3 scripts/smoke_test.py --base-url <render url> --access-key <key>`.
5. PWA: Chrome on Android → Install app; add `NEXUS_HEALTH_URL` secret for keep-alive.

1. `frontend/` Next.js (App Router) + TypeScript + Tailwind shell.
   - `next.config.js` rewrites `/api/v1/*` to `API_BACKEND_URL`.
   - CSS custom properties for live typography/dark palette/accent/reading-width.
   - `manifest.json` + Share Target `/capture?title=...&text=...&url=...` for Android PWA.
   - Cold-start wake banner: `/api/v1/health` shows `status: "degraded"` when DB down;
     UI polls `/api/v1/auth/session` and shows "Waking up NEXUS…" instead of error.
2. Pages: Dashboard (stats, continue reading, recently added), Library (Compact Table /
   Reading Cards layouts, filters: Format, Blueprint, Triage, Time Budget, Collection, Tag;
   "Save as Smart Lens"), Search (multi-faceted with `ts_headline` snippets), Omni-Capture
   launcher (File | Paste URL | Manual Paste | New Markdown), Item Inspector (PDF.js
   canvas viewer + segment list with `is_scanned`/failed banner; Markdown/Note inline edit
   with re-index; Universal drawer: Triage, Blueprint fields, Collections, Tags, Typed
   Links, Prompt Context copy, Export buttons), Collections tree, Tag Manager (+aliases,
   Merge), Studio (Blueprints, Relation Types, Prompt Templates), Settings (Appearance
   customizer, Storage health, Full Backup Export, API docs).
3. Run tests: `cd frontend && npm test` (if configured) + full E2E smoke test from
   `scripts/smoke_test.py` (create 2-page PDF with text+image page, upload, verify
   `is_scanned`, search Page 1 text → exact page match, export Markdown+YAML, delete).
4. Finalize: `README.md` (free Vercel + Render + Supabase deploy steps + optional
   GitHub Actions keep-alive), `AGENTS.md`, `docs/PROJECT_STATE.md`,
   `docs/EXTENSION_GUIDE.md`.

---

## Stage 6 — Self-Verifying Smoke Test, Free CI & Handoff Docs

### 6.1 Self-Verifying E2E Smoke Test (`scripts/smoke_test.py`)
- Generates a 2-page PDF in memory (Page 1: unique phrase; Page 2: vector drawing, no text)
- Runs full proof against live API:
  1. `GET /api/v1/health` — exits cleanly with diagnostic if DB unavailable
  2. `POST /api/v1/auth/session` — if passcode enabled
  3. `POST /api/v1/ingest` — upload PDF, assert 201 + `item_id`
  4. `GET /api/v1/items/{id}/segments` — Page 1 has phrase, Page 2 `is_scanned=True`
  5. `GET /api/v1/search` — phrase hit matches `item_id` + `segment_label="Page 1"`
  6. `GET /api/v1/items/{id}/export?format=markdown` — valid frontmatter + body
  7. `DELETE /api/v1/items/{id}` — cleanup confirmed
- Unit test in `backend/tests/test_smoke_pdf.py` verifies PDF generator offline

### 6.2 Free GitHub Actions CI (`.github/workflows/ci.yml`)
- Backend job: `pytest -q` + `pyflakes` on `ubuntu-latest`
- Frontend job: `npm ci && npm run typecheck && npm run build` on `ubuntu-latest`
- Proves Linux/Vercel build health for $0

### 6.3 Optional Keep-Alive (`.github/workflows/keep-alive.yml`)
- Cron every 5 days pings `secrets.NEXUS_HEALTH_URL`
- Skips cleanly if secret not set

### 6.4 Render Free Config (`render.yaml`)
- Free Web Service, `rootDir: backend`, health check `/api/v1/health`
- All required env vars marked `sync: false`

### 6.5 Deployment Docs Updated
- `README.md`: Complete $0 Deployment Guide (Supabase → Render → Vercel → Smoke Test → PWA)
- `docs/EXTENSION_GUIDE.md`: Recipes for extractor, storage, export, workflow modules
- `docs/ROADMAP.md`: v1.1 (Highlights, Flashcards, Daily Notes, Tasks) + v1.2 (Notebooks, Auto-Routing, Weekly Review, Extended Extractors, Browser OCR, pgvector)
- `AGENTS.md`: Updated with smoke test commands and Stage 6 status

### Verification (Stage 6)
```
$ cd nexus/backend && python3 -m pytest -q              # 132 passed
$ cd nexex/backend && python3 -m pyflakes app tests ../scripts  # clean
$ cd nexus/frontend && npm run typecheck               # exit 0
$ cd nexus/frontend && npm run build                   # 10 routes, 84.5 kB shared
```

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
