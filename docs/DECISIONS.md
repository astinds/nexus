# DECISIONS — Architecture Decision Records

Short records of *why*. Each entry: context, decision, consequences, alternatives.
Numbering is stable; append new records, never renumber.

---

## ADR-001 — PostgreSQL only, no SQLite shim

**Context.** NEXUS needs `tsvector` search, `JSONB` custom fields, `TEXT[]` aliases and
GIN indexes. A SQLite development shim would diverge on all four.

**Decision.** One PostgreSQL target from day one. No ORM abstraction layer that promises
portability the app does not need.

**Consequences.** Development requires a reachable PostgreSQL (Supabase Free). Tests that
do not need SQL run without it; SQL-shaped behaviour is covered by builder tests and by
static migration validation. This device cannot run a local server (see PROJECT_STATE),
which is an accepted, documented gap rather than a design change.

**Alternatives rejected.** SQLite + FTS5 (no `tsvector`, no `JSONB` operators, index
syntax differs); DuckDB (no concurrent writers, different full-text model).

---

## ADR-002 — `source_format` and `blueprint_id` are independent

**Context.** Most document tools conflate container and meaning, so a PDF is "a PDF" and
never "a Policy Brief".

**Decision.** `source_format` is an immutable enum set at capture. `blueprint_id` is a
nullable FK to a user-defined schema with `fields_schema` JSONB. Neither derives from the other.

**Consequences.** One file format can satisfy several blueprints; changing a blueprint
never rewrites files. Filters must query both dimensions separately (implemented in
`LibraryFilters`).

---

## ADR-003 — Capture with zero mandatory fields, triage after

**Context.** Friction at capture is what kills personal knowledge systems. Requiring a
title, tags or collection at capture time means items are never captured at all.

**Decision.** `POST /api/v1/ingest` accepts a bare file or bare text. Title falls back to
a humanised filename or "Untitled note". Everything defaults to `triage_status = 'inbox'`.

**Consequences.** Inbox can grow untidily — that is intended, and handled by the
Triage lifecycle plus Time-Budget filters rather than by capture-time forms.

---

## ADR-004 — Generated `tsvector` column instead of a trigger

**Context.** `item_segments.search_vector` must always match `content`.

**Decision.** `search_vector tsvector generated always as (to_tsvector('english', content)) stored`.

**Consequences.** No trigger, no backfill migration, no way for the index to drift. Cost:
a change to the text-search configuration requires a new migration that rewrites the
column. Acceptable — the config is stable.

**Alternatives rejected.** Trigger-maintained column (silent drift on bulk updates);
application-side `tsvector` writes (one forgotten path and search goes stale).

---

## ADR-005 — Deduplication by SHA-256, unique per workspace

**Context.** Re-capturing the same PDF must not create a second item; but the same bytes
may legitimately belong to two workspaces.

**Decision.** `items.content_hash` stores SHA-256. A partial unique index enforces
`(workspace_id, content_hash)`. `IngestService` looks up the hash before writing and
returns the existing item with `duplicate: true`.

**Consequences.** Re-upload is idempotent and cheap. Editing a note recomputes its hash,
so a note is deduplicated against its latest saved content, not its history.

---

## ADR-006 — Passcode gate as one dependency, not middleware

**Context.** v1.0 is single-user. Supabase Auth + RLS may replace it later.

**Decision.** `require_access` is a FastAPI dependency attached per router. The cookie
stores an HMAC of a fixed label keyed by the passcode, never the passcode itself.

**Consequences.** Swapping to real auth touches one function signature. Because the gate
is per-route, `GET /api/v1/health`, `/meta` and `/` stay public — needed for cold-start
Banner logic and Render health checks.

**Alternatives rejected.** Middleware (harder to exempt health checks); JWT (extra
dependency and key management for a single user).

---

## ADR-007 — Storage abstraction with raw httpx for Supabase

**Context.** Render Free gives 512 MB RAM; the `supabase` Python SDK pulls a large
dependency tree for three endpoints.

**Decision.** `BaseStorage` with `LocalStorage` (filesystem) and `SupabaseStorage`
(httpx REST: upload/get/delete/sign). URIs are `local://<key>` and
`supabase://<bucket>/<key>`.

**Consequences.** Identical contract in tests and production; no SDK upgrade churn.
Signed URLs are minted on demand so the bucket stays private. Download route streams
through the API as a fallback when signing is unavailable.

---

## ADR-008 — Explicit column lists and pagination everywhere

**Context.** Supabase Free gives 500 MB database and 5 GB egress; Render Free gives
512 MB RAM. `select *` on `items` returns `custom_fields`, `metadata` and
`reading_progress` JSONB blobs nobody needs in a list.

**Decision.** `repositories/items.py` defines `LIST_COLUMNS` explicitly; every list
endpoint paginates with `limit` (max 200) and `offset`. Segment bodies are fetched only
by the detail and segment endpoints.

**Consequences.** Library listing stays cheap as the corpus grows. Adding a column to a
list response requires editing one constant — intentional friction.

---

## ADR-009 — Honest extraction: `partial` is a normal, visible state

**Context.** Silent failure is the worst outcome for a research library: a scanned page
that yields `""` looks like an empty page, and the user trusts it.

**Decision.** Per-segment `extraction_status` (`ok|empty|scanned|failed|skipped`) and
`is_scanned`; per-item `processing_status` becomes `partial` when any segment is not
`ok`; warnings are stored in `items.error_message` and returned by the ingest response;
`integrity_summary()` lists the exact labels needing attention.

**Consequences.** The inspector can always show "Page 4 is scanned, Page 7 failed".
Nothing is retried invisibly, and no page is dropped.

---

## ADR-010 — FastAPI + Next.js as separate services, proxied

**Context.** Vercel Hobby runs the frontend; Render Free runs FastAPI. Browsers hitting
Render directly meet CORS preflights and cookie `SameSite` restrictions.

**Decision.** Next.js `rewrites()` proxies `/api/v1/*` to `API_BACKEND_URL` server-side.
The browser only ever talks to one origin. `CORS_ORIGINS` exists but is not needed in
the recommended setup.

**Consequences.** Cookies are same-origin, no preflight cost, and `NEXT_PUBLIC_API_ORIGIN`
stays empty. Direct API use (curl, smoke test) still works via `X-Nexus-Key`.

---

## ADR-011 — 1-based page numbering, always

**Context.** PyMuPDF's Python API is 0-based; humans and PDF readers are 1-based.
Off-by-one page numbers destroy trust in a reader.

**Decision.** `segment_index` and labels are 1-based at the extractor boundary. The
`PdfExtractor` adds 1 the moment it reads a page; nothing downstream ever converts.

**Consequences.** Snippet "Page 4" always means the fourth page. Any future extractor
must follow the same rule (stated in AGENTS.md as an invariant).

---

## ADR-012 — Pure-Python extractors first, native second

**Context.** The development device cannot load PyMuPDF (libtesseract/libc++ symbol
mismatch), so a design that hard-depends on it cannot even be smoke-tested here.

**Decision.** Extractors are resolved through a registry; the PDF extractor tries
`pymupdf` and falls back to `pypdf`, reporting which engine ran. Pure-Python extractors
(Markdown/text/HTML/CSV/JSON/notes) carry no native dependency.

**Consequences.** Local development and CI work without native libraries; production gets
the better engine. Engine identity is recorded in `metadata.engine` so extraction quality
is auditable.

---

## ADR-013 — Next.js App Router + SWC build constraint on ARM64 Android

**Context.** Stage 5A initializes Next.js 14 App Router for the frontend. Next.js 14.1.3
defaults to SWC as its compiler, which requires native binary packages per platform.
On ARM64 Android, `@next/swc-android-arm64` is not published to npm (404), so `next build`
fails while trying to download it.

**Decision.** The workaround is opt-in, not the default: `next.config.mjs` only sets
`experimental.useWasmBinary` and `experimental.webpackBuildWorker: false` when
`NEXUS_SWC_WASM=1` is present. Linux and Vercel builds therefore use native SWC with no
experimental flags at all, and this device can opt in when experimenting. The rewrite
proxy is always configured.

**Consequences.** Production builds are unaffected by the device constraint. On this
device `next build` still fails at the native download step even with the flag (the
WASM fallback is not reached in 14.1.3), so verification here is `tsc --noEmit` plus a
Tailwind CLI compile rather than a full production build. That gap is documented, not
hidden.

**Alternatives rejected.** Forcing `useWasmBinary` globally (breaks clean builds on
Linux); downgrading Next.js (invasive); vendoring a fake native package (fragile).

---

## ADR-014 — Stage 5A Frontend Architecture

**Context.** Stage 5A implements the NEXUS frontend core: shell, dashboard, library,
search, omni-capture, theme engine, cold-start wake banner, and passcode gate.

**Decision.**

- **Next.js App Router** with TypeScript strict mode, Tailwind CSS driven by CSS custom properties
- **Typed API client** (`src/lib/types.ts` + `src/lib/api.ts`) matching FastAPI `/api/v1`
  schemas exactly: items, ingest, search, dashboard, auth/session, health, preferences,
  saved views, workspaces, blueprints, collections, tags, relation types
- **Theme engine** initialized from `GET /api/v1/preferences` with clean dark defaults
  (`--bg`, `--surface`, `--accent`, `--font-reading`, `--reading-width`, `--font-scale`)
- **Cold-start wake banner** ("Waking up NEXUS engine…") with retry when health/session
  is unreachable or degraded
- **Passcode gate** wired to `/api/v1/auth/session`; auto-bypassed in dev open mode
- **Responsive minimalist dark shell**: mobile-first bottom/drawer nav + desktop sidebar,
  workspace switcher, pinned smart lenses, `Cmd/Ctrl+K` quick search, persistent
  Omni-Capture trigger
- **Dashboard** (`/`): totals by format/blueprint/triage, Inbox count, Continue Reading,
  Recently Added, Recent Activity, Quick Capture, Search bar
- **Omni-Capture Modal**: Upload File, Clip URL with Paste Article fallback tab,
  New Markdown Note — all wired to backend ingest endpoints
- **Library** (`/library`): Table/Cards toggle, filters for Format/Blueprint/Triage/
  Time Budget/Collection/Tag, pagination, "Save as Smart Lens" (`POST /api/v1/saved-views`)
- **Search** (`/search`): multi-faceted full-text search with `ts_headline` snippets linking
  to `/items/[id]`

**Consequences.** Every component targets <= 300 lines, mobile-first at 320px, zero
decorative clutter or unnecessary animations. Stage 5B (Item Inspector, Collections/
Tags Manager, Studio, Settings, PWA Share Target) and Stage 6 (smoke test/deployment
docs) are deliberately out of scope for Stage 5A.

---

## ADR-015 — `ts_headline` snippets are parsed, never injected

**Context.** `GET /api/v1/search` returns `snippet` from PostgreSQL `ts_headline`, which
wraps matched terms in delimiters (`<b>…</b>`). The surrounding text is document
content — arbitrary user-supplied HTML, scripts included.

**Decision.** `HighlightedSnippet` splits the snippet on the two delimiters and renders
each piece as a React text node inside `<strong>` or `<span>`. No
`dangerouslySetInnerHTML` anywhere in the frontend.

**Consequences.** Document HTML is escaped by React automatically, so a captured page
containing `<script>` cannot execute in the search results. The cost is one small parser
and the assumption that the delimiters stay `<b>`/`</b>` — if `ts_headline` options
change, `HighlightedSnippet` must change with them.

**Alternatives rejected.** `dangerouslySetInnerHTML` (XSS by design); server-side
sanitising (extra dependency, and the highlight would still need re-marking).

---

## ADR-016 — Membership edits go through `PATCH /items/{id}`

**Context.** Stage 5B's inspector lets the user change an item's collections and tags
after capture. Those live in the `item_collections` and `item_tags` join tables, and no
route existed to change them outside ingest.

**Decision.** `ItemUpdate` gains optional `tags` and `collection_ids`. Sending either
replaces that membership wholesale (`replace_for_item`); omitting it leaves membership
untouched. The service pops both keys before the row update, because they are not columns.

**Consequences.** One endpoint covers metadata and membership, and "clear all tags" is
expressible as `[]` rather than a separate delete call. The replace semantics mean a
client must send the complete list, never a delta — documented on the model and covered
by `test_item_update_membership_lists_are_optional_and_replace_not_patch`.

**Alternatives rejected.** Separate `/items/{id}/tags` routes (more surface, same
transaction); patching only at ingest (forces re-capture to re-file an item).

---

## ADR-017 — Unlocking a real `next build` on ARM64 Android

**Context.** ADR-013 recorded that `next build` could not complete on this device. Three
separate defects blocked it, each found by running the build and reading the failure:

1. `next/dist/build/webpack-config.js` calls `getBinaryMetadata()`, which calls
   `loadBindings()` **with no argument**. `loadBindings()` caches only its first call, so
   that argument-less call took the native-binary path first, failed, and exited the
   process before the `useWasmBinary` call site was ever reached.
2. The webpack build worker forks a child process that dies immediately (`write EPIPE` in
   `jest-worker`), killing the compile before it starts.
3. The page-data and type-check workers fork the same way and died at the same point.

**Decision.**
- `frontend/scripts/next.mjs` is the entry point for `dev`, `build` and `start`. It awaits
  `loadBindings(true)` **before** requiring `next/dist/bin/next`, so the cached bindings are
  the WASM ones and every later `loadBindings()` call — with or without the argument —
  reuses them.
- `next.config.mjs` enables `experimental.useWasmBinary`, `webpackBuildWorker: false` and
  `experimental.workerThreads: true` when `process.platform === 'android'` (or when
  `NEXUS_SWC_WASM=1` is set). `workerThreads` runs those workers as threads instead of
  forks, which sidesteps the EPIPE.
- `package.json` scripts call tools by path (`node scripts/next.mjs`,
  `node node_modules/typescript/lib/tsc.js`) because the workspace sits on shared storage
  where npm installs with `--no-bin-links`, leaving `node_modules/.bin` empty.

**Consequences.** A full production build now succeeds on this device: 10 routes, 84.5 kB
shared JS. Linux/Vercel builds are unaffected — the platform check is false there, so no
experimental flags are applied and native SWC is used. The WASM compiler is slower (a cold
build takes about 100 s here) and webpack logs a harmless
`Caching failed for pack: Unable to snapshot resolve dependencies` warning from the
filesystem.

**Alternatives rejected.** Patching `node_modules` (lost on reinstall); adding a Babel
config to bypass SWC entirely (much slower, and SWC is still used for minification);
`typescript.ignoreBuildErrors` to dodge defect 3 (would hide real type errors).
