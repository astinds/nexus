# AGENTS.md — read this first

NEXUS v1.0 is a zero-cost personal information and document intelligence platform.
This file is the entry point for **any** engineer or AI model continuing the work.
It is written to be sufficient on its own: no chat history required.

> **Status: Stage 6 of 6 complete** — self-verifying smoke test, CI, Render config,
> deployment docs.
> Commits: `94d4f1c` (Stage 5B+ARM64 unlock), `31216b0` (Stage 6)

---

## 1. What NEXUS is

Capture anything (PDF, DOCX, web article, Markdown, CSV, JSON, pasted text), extract
it into searchable segments, read it without losing your place, connect it to other
material with typed links, and export it losslessly. Runs free: Vercel Hobby +
Render Free + Supabase Free.

**Two concepts that must never be confused:**

| Concept | Column | Example | Mutable? |
|---|---|---|---|
| Container format | `items.source_format` | `pdf`, `docx`, `web_article`, `note` | No — set once at capture |
| Conceptual schema | `items.blueprint_id` | *Book*, *Research Paper*, *Policy Brief* | Yes — user assigns/edits |

A PDF can be a *Policy Brief* or a *Book*; the file format says nothing about meaning.
Blueprints carry `fields_schema` (JSONB) describing typed custom fields whose values
live in `items.custom_fields`.

---

## 2. Directory map

```
nexus/
├── AGENTS.md                     ← you are here
├── README.md                     ← setup + free-tier deployment (Stage 6)
├── .env.example                  ← every env var, backend + frontend
├── requirements.txt              ← production deps (Render, glibc wheels)
├── requirements-dev.txt          ← dev deps incl. Android/Termux notes
├── supabase/migrations/          ← numbered, idempotent SQL
│   ├── 001_initial_schema.sql
│   ├── 002_updated_at_triggers.sql
│   └── 003_collection_tree.sql
├── scripts/
│   └── apply_migrations.py       ← idempotent migration runner (checksums)
├── docs/
│   ├── PROJECT_STATE.md          ← living handoff sheet (update every stage)
│   ├── DECISIONS.md              ← ADRs: why, not what
│   ├── ROADMAP.md                ← v1.1 / v1.2 plug-in specs
│   └── EXTENSION_GUIDE.md        ← recipes: extractor, storage, export, module
├── backend/
│   ├── app/
│   │   ├── main.py               ← create_app(), CORS, error handlers, lifespan
│   │   ├── config.py             ← Settings (pydantic-settings), warnings()
│   │   ├── db.py                 ← psycopg pool, DatabaseUnavailable
│   │   ├── auth.py               ← single-user passcode gate (FastAPI dependency)
│   │   ├── errors.py             ← ApiError + one error JSON shape
│   │   ├── text.py               ← hashing, slugs, YAML-safe scalars, chunking
│   │   ├── formats.py            ← extension/MIME -> SourceFormat
│   │   ├── models/               ← Pydantic v2 contracts (common, library, items)
│   │   ├── api/                  ← routers: system, catalog, items, studio, ingest
│   │   ├── services/             ← orchestration + business rules
│   │   ├── repositories/         ← SQL only, returns dicts
│   │   ├── extractors/           ← BaseExtractor registry + implementations
│   │   └── storage/              ← BaseStorage + Local + Supabase
│   ├── tests/                    ← pytest, no live DB required
│   └── pytest.ini
└── frontend/                     ← Next.js App Router (Stage 5)
```

---

## 3. Commands

Run everything from `backend/` unless stated.

```bash
# ---------- tests (no database needed) ----------
cd backend && python3 -m pytest              # 132 passed at Stage 6

# ---------- lint ----------
python3 -m pyflakes app tests ../scripts     # must print nothing

# ---------- run the API locally ----------
cd backend && uvicorn app.main:app --reload --port 8000
# open http://127.0.0.1:8000/docs

# ---------- migrations ----------
python scripts/apply_migrations.py --dry-run                  # list files
DATABASE_URL=postgresql://... python scripts/apply_migrations.py
DATABASE_URL=postgresql://... python scripts/apply_migrations.py --verify

# ---------- smoke test (E2E, requires running API) ----------
# Local:
python3 scripts/smoke_test.py --base-url http://127.0.0.1:8000
# Deployed (with passcode):
python3 scripts/smoke_test.py --base-url https://<your-render>.onrender.com \
    --access-key <NEXUS_ACCESS_KEY>

# ---------- install deps on Android/Termux ----------
pip install --only-binary=:all: \
    --extra-index-url https://termux-user-repository.github.io/pypi/ \
    -r requirements-dev.txt
```

`--only-binary=:all:` is **mandatory** on Android: source builds fail there (no
`/bin/sh` inside the Python build sandbox).

---

## 4. Layering (do not break this)

```
api/  ->  services/  ->  repositories/  ->  PostgreSQL
```

- **api/**: HTTP shape only. Parses params, calls one service, returns a model.
  Never builds SQL, never opens a connection directly (`Depends(get_cursor)`).
- **services/**: business rules, orchestration, activity logging, raising `ApiError`.
- **repositories/**: SQL and row->dict. Never raises HTTP errors. Every user value is
  a bound parameter; identifiers come from module-level whitelists only.
- **models/**: Pydantic v2. This *is* the API contract; the frontend mirrors it.

Transactions: `get_cursor` yields one connection per request. The pool commits when
the response is produced and rolls back on exception. A request is atomic.

---

## 5. Hard invariants (breaking these is a bug, not a preference)

1. `source_format` and `blueprint_id` stay independent. Never derive one from the other.
2. Zero mandatory fields on capture. A capture with no title, no tags, no blueprint must work.
3. Extraction is **honest**: never delete a page, never silently swallow an error.
   - `is_scanned = true` for image-only pages, `extraction_status = 'failed'` for
     unreadable ones, `processing_status = 'partial'` when anything is missing.
   - PDFs use **1-based** page numbers, always (`segment_index`, labels "Page 1"…).
4. `import pymupdf` only. `import fitz` is a legacy alias and is forbidden.
   `pypdf` is permitted *only* as a fallback when the native module cannot load.
5. File bytes never enter PostgreSQL. They live in Storage behind `BaseStorage`.
6. Web clips keep an archival `snapshot_uri` next to the extracted text.
7. Every list endpoint paginates (`limit` <= 200, `offset`), and selects an explicit
   column list — never `select *` on `items` for lists.
8. Secrets only from env. `.env` is gitignored; `.env.example` documents every var.
9. Migrations are numbered, idempotent, and never edited after being applied —
   add a new numbered file instead.
10. Modules stay small and boring: target <= 300 lines per file.

---

## 6. Auth model

Single user, one shared passcode. `NEXUS_ACCESS_KEY` unset => open dev access (with a
warning in `/api/v1/health`). Set => every data route requires either:

- header `X-Nexus-Key: <passcode>`, or
- the `nexus_session` HttpOnly cookie from `POST /api/v1/auth/session`.

The cookie holds an HMAC of a fixed label keyed by the passcode, never the passcode.
All routes depend on `require_access`; to swap in Supabase Auth + RLS later, replace
that one dependency (see ADR-006).

---

## 7. Error contract

```json
{"error": {"code": "not_found", "message": "item 42 not found", "detail": null}}
```

Codes in use: `bad_request`, `not_found`, `conflict`, `unprocessable`,
`validation_error`, `unauthorized`, `invalid_key`, `missing_key`, `file_too_large`,
`database_unavailable`, `storage_error`, `duplicate_tag`, `last_workspace`, `cycle`,
`self_link`, `duplicate_link`, `wrong_ingest_channel`, `not_editable`, `no_file`.

---

## 8. Environment caveats (this development device)

Two Android-specific limits are documented in full in `docs/PROJECT_STATE.md`:

1. **No local PostgreSQL.** `initdb` hangs at its `max_connections` probe on this
   device, so migrations are validated statically by tests and applied against a real
   database only when `DATABASE_URL` points at Supabase.
2. **PyMuPDF cannot load here.** The Termux package links `libtesseract`, which needs a
   newer `libc++` symbol than this prefix provides. `PdfExtractor` therefore falls back
   to `pypdf` locally; on Render (glibc wheels) PyMuPDF is the primary engine.

Both are environment facts, not design choices. Do not "fix" them by editing app code
paths that are correct; check `docs/PROJECT_STATE.md` first.

---

## 9. Conventions

- Python 3.12+ syntax allowed (`str | None`, `match`, dataclass `slots=True`).
- British-neutral English in prose, US spelling in identifiers (`color`, `normalize`).
- Docstrings explain *why*. Docstrings that restate the function name are noise.
- No `print()` in `app/` — use `logging`.
- Frontend (Stage 5): TypeScript strict, Tailwind driven by CSS custom properties,
  mobile-first at 320px, no animation beyond purposeful transitions.
