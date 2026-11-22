# NEXUS

Zero-cost personal information and document intelligence. Capture anything, extract it
into searchable segments, read it without losing your place, connect it with typed
links, export it losslessly.

Runs entirely on free tiers: **Vercel Hobby** (frontend) + **Render Free** (API) +
**Supabase Free** (Postgres + Storage). $0/month.

> Status: **Stage 6 of 6 complete** — self-verifying smoke test, CI, Render config,
> deployment docs.
> See [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) for the exact current state.

---

## Quick look

| Layer | Stack | Location |
|---|---|---|
| API | FastAPI, Pydantic v2, psycopg3 | `backend/` |
| Database | PostgreSQL 15+ (Supabase) with `tsvector` + JSONB | `supabase/migrations/` |
| Storage | `LocalStorage` or `SupabaseStorage` (private bucket) | `backend/app/storage/` |
| Frontend | Next.js App Router + TypeScript + Tailwind | `frontend/` |

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
cd backend && python3 -m pytest          # 132 passed
python3 -m pyflakes app tests ../scripts # no output
```

On Android/Termux add `--extra-index-url https://termux-user-repository.github.io/pypi/`
and `pkg install python-pymupdf libpq`. `--only-binary=:all:` is required there.

---

## $0 Deployment Guide (copy-paste ready)

### 1. Supabase Free — Database + Storage

1. Create a project at [supabase.com](https://supabase.com) (Free tier: 500 MB DB, 1 GB storage).
2. **SQL Editor** → run migrations in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_updated_at_triggers.sql`
   - `supabase/migrations/003_collection_tree.sql`
   Or run locally: `DATABASE_URL=... python scripts/apply_migrations.py`
3. **Storage** → create a **private** bucket named `nexus-files`.
4. **Project Settings → Database → Connection string → URI** — copy this as `DATABASE_URL`.
   Prefer the **pooler** host (port 6543) for Render.

> Supabase Free has **no automatic backups**. The Settings page (Stage 5B) exports
> everything as a ZIP; run it monthly.

### 2. Render Free — API Backend

1. New → **Web Service** → connect this repo.
2. Root directory: `backend`
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. **Environment variables** (set in Render dashboard, *not* in this file):

| Variable | Value |
|---|---|
| `DATABASE_URL` | From Supabase step 1 (pooler URI) |
| `NEXUS_ACCESS_KEY` | Long random string (e.g. `openssl rand -hex 32`) |
| `STORAGE_BACKEND` | `supabase` |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase **service_role** key (Settings → API) |
| `SUPABASE_BUCKET` | `nexus-files` |
| `MAX_UPLOAD_MB` | `25` |
| `COOKIE_SECURE` | `true` |
| `PYTHONUNBUFFERED` | `1` |

6. **Health check path**: `/api/v1/health`

> Render Free sleeps after 15 min of inactivity; first request takes ~30 s.
> The frontend shows "Waking up NEXUS…" instead of an error.

### 3. Vercel Hobby — Frontend

1. New Project → import repo → **Root Directory**: `frontend`
2. **Environment variable**:

| Variable | Value |
|---|---|
| `API_BACKEND_URL` | `https://<your-render-service>.onrender.com` |

3. Deploy.

> `/api/v1/*` is rewritten to the API server-side — no CORS, cookies stay same-origin.

### 4. Live Proof (Smoke Test)

```bash
python3 scripts/smoke_test.py \
  --base-url https://<your-render-service>.onrender.com \
  --access-key <your-NEXUS_ACCESS_KEY>
```

Expected output:
```
🚀 Starting smoke test against https://...
✅ Health OK: {...}
✅ Authenticated via session cookie
📄 Generated 2-page PDF (XXXXX bytes), phrase: NEXUS-SMOKE-XXXXXXXX
✅ Ingested item: <uuid>
✅ Page 1 extracted phrase: NEXUS-SMOKE-XXXXXXXX...
✅ Page 2 flagged is_scanned=True (no text, vector only)
✅ Search hit: item=<uuid>, segment=Page 1
✅ Export OK: frontmatter + body (XXXXX chars)
✅ Deleted item: <uuid>
🎉 ALL SMOKE TESTS PASSED
```

### 5. Android PWA — Install & Share

1. Open the Vercel URL in Chrome on Android.
2. Menu → **Install app** → "NEXUS" appears on home screen.
3. In any app (browser, file manager), **Share** → select **NEXUS** → the capture page opens
   with the shared text/URL/file pre-filled.

---

## Optional: Keep Render Awake (prevents cold starts)

The free tier sleeps after 15 min. To keep it warm, add the GitHub secret
`NEXUS_HEALTH_URL=https://<your-render>.onrender.com/api/v1/health`
and `.github/workflows/keep-alive.yml` will ping it every 5 days (free on GitHub Actions).

> Note: Render's 750 free hours/month are shared across services. A keep-alive spends
> them faster — only enable if cold starts bother you.

---

## Security model

- Single user, one shared passcode (`NEXUS_ACCESS_KEY`).
- When set: every data route needs `X-Nexus-Key: <passcode>` or the HttpOnly
  `nexus_session` cookie from `POST /api/v1/auth/session`.
- When unset: API runs open and `/api/v1/health` says so loudly.
- `SUPABASE_SERVICE_KEY` bypasses RLS: only in Render env, never in frontend or commits.

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
