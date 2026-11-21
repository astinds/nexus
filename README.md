# NEXUS

Zero-cost personal information and document intelligence. Capture anything, extract it
into searchable segments, read it without losing your place, connect it with typed
links, export it losslessly.

Runs entirely on free tiers: **Vercel Hobby** (frontend) + **Render Free** (API) +
**Supabase Free** (Postgres + Storage). $0/month.

> Status: **Stage 3 of 6 complete** — backend core, schema, passcode gate, ingest.
> Extractors beyond text, search and export land in Stage 4; the frontend in Stage 5.
> See [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) for the exact current state.

---

## Quick look

| Layer | Stack | Location |
|---|---|---|
| API | FastAPI, Pydantic v2, psycopg3 | `backend/` |
| Database | PostgreSQL 15+ (Supabase) with `tsvector` + JSONB | `supabase/migrations/` |
| Storage | `LocalStorage` or `SupabaseStorage` (private bucket) | `backend/app/storage/` |
| Frontend | Next.js App Router + TypeScript + Tailwind (Stage 5) | `frontend/` |

---

## Local development

```bash
# 1. Python dependencies
pip install --only-binary=:all: -r requirements-dev.txt

# 2. Configuration
cp .env.example backend/.env      # then set DATABASE_URL
# leave NEXUS_ACCESS_KEY empty for open local development

# 3. Schema
python scripts/apply_migrations.py --dry-run
DATABASE_URL=postgresql://... python scripts/apply_migrations.py

# 4. Run
cd backend && uvicorn app.main:app --reload --port 8000
# -> http://127.0.0.1:8000/docs

# 5. Test
cd backend && python3 -m pytest          # 81 passed
python3 -m pyflakes app tests             # no output
```

On Android/Termux add `--extra-index-url https://termux-user-repository.github.io/pypi/`
and `pkg install python-pymupdf libpq`. `--only-binary=:all:` is required there.

---

## Deploy free (three services, no card)

### 1. Supabase (database + storage)

1. Create a project (free tier: 500 MB DB, 1 GB storage).
2. **SQL Editor** → paste `supabase/migrations/001_initial_schema.sql`, then `002`, then
   `003`, or run `DATABASE_URL=... python scripts/apply_migrations.py` locally.
3. **Storage** → new **private** bucket named `nexus-files`.
4. **Project Settings → Database → Connection string → URI** — that is `DATABASE_URL`.
   Prefer the **pooler** host (port 6543) for Render.

> Supabase Free has **no automatic backups**. Settings → "Backup library" (Stage 5)
> exports everything as a ZIP; run it monthly.

### 2. Render (API)

1. New → **Web Service** → connect the repo.
2. Root directory `backend`, build `pip install -r ../requirements.txt`,
   start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
3. Environment:
   `DATABASE_URL`, `NEXUS_ACCESS_KEY` (long random string), `STORAGE_BACKEND=supabase`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET=nexus-files`,
   `COOKIE_SECURE=true`, `MAX_UPLOAD_MB=25`.
4. Health check path: `/health`.

Render Free sleeps after 15 minutes of inactivity; the first request after that takes
about 30 seconds. The frontend shows a "Waking up NEXUS…" state instead of an error.

### 3. Vercel (frontend, Stage 5)

1. New Project → root directory `frontend`.
2. Environment: `API_BACKEND_URL=https://<your-service>.onrender.com`.
3. Deploy. `/api/v1/*` is rewritten to the API server-side, so there are no CORS
   preflights and cookies stay same-origin.

### Optional: keep Render awake

`.github/workflows/keep-alive.yml`:

```yaml
name: keep-alive
on:
  schedule:
    - cron: "*/10 * * * *"
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -fsS --max-time 25 "${{ secrets.NEXUS_HEALTH_URL }}" || true
```

`NEXUS_HEALTH_URL` = `https://<service>.onrender.com/health`. GitHub Actions is free for
public repos and 2,000 minutes/month for private ones; this job uses about 1 minute per
day. Note that Render's monthly free hours (750) are shared across services — a
keep-alive spends them faster, so use it only if cold starts bother you.

---

## Security model

Single user, one shared passcode (`NEXUS_ACCESS_KEY`). When it is set, every data route
needs either `X-Nexus-Key: <passcode>` or the HttpOnly `nexus_session` cookie from
`POST /api/v1/auth/session`. When it is unset the API runs open and `/api/v1/health`
says so loudly.

`SUPABASE_SERVICE_KEY` bypasses row-level security: it belongs only in Render's
environment, never in the frontend or a commit.

---

## Documentation map

| File | Purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | Architecture, commands, layering, invariants — start here |
| [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) | Living handoff: what works now, caveats, next step |
| [docs/DECISIONS.md](docs/DECISIONS.md) | ADRs: why the design is this way |
| [docs/ROADMAP.md](docs/ROADMAP.md) | v1.1 and v1.2 plug-in specs |
| [docs/EXTENSION_GUIDE.md](docs/EXTENSION_GUIDE.md) | Recipes: extractor, storage, export, module |

Licence: none chosen yet — add one before publishing.
