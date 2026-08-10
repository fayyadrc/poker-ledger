# Render → Vercel + Supabase migration

Target: the React SPA and the Django API run on **one Vercel project** (same origin,
so session auth keeps working), backed by **Supabase Postgres**.

```
Vercel project (one origin)
  /                 → React SPA (static, CDN)
  /api/*  /_allauth/*  /admin/*  /static/*  → api/index.py → Django (serverless)
                                   │  psycopg2 / TLS
                                   ▼
                        Supabase Postgres (restored data)
```

Code/config already in place (committed with this doc):
- `api/index.py` — Vercel serverless WSGI entrypoint for Django.
- `vercel.json` — build the SPA, route API/allauth/admin/static to Django, SPA for the rest.
- `backend/config/settings.py` — serverless-aware DB (CONN_MAX_AGE=0), TLS, `.vercel.app`
  hosts, HTTPS-proxy header, secure cookies. All gated on env; local dev is unchanged.
- `.gitignore` — `poker_ledger_db/` and `exports/` are ignored (they hold real user data).

---

## ⚠️ The one non-negotiable rule (read first)

The app's security uses **Postgres Row-Level Security** driven by a **session variable**
(`SetRLSUserMiddleware` → `set_config('app.current_user_id', …, FALSE)`).

Session variables only survive on a **session-mode** connection. Therefore:

> **Use Supabase's _Session pooler_ (or the direct connection). NEVER the _Transaction
> pooler_ (port `6543`).** The transaction pooler would break RLS silently — users seeing
> empty data, or RLS failing open. (Django also filters by owner, so it fails safe, but
> don't rely on that — use the right connection.)

- App runtime `DATABASE_URL` → **Session pooler**, host `…pooler.supabase.com`, port **5432**.
- `CONN_MAX_AGE=0` on Vercel is set automatically (see settings).

---

## Phase 1 — Supabase (database)

1. **Create the project** at https://supabase.com (New project). Pick a strong DB password
   and a region close to your Vercel region. *(Account creation is yours — I can't do it.)*

2. **Grab two connection strings** from the dashboard → **Connect**:
   - **Direct connection** (`db.<ref>.supabase.co:5432`) — use for the one-time restore.
   - **Session pooler** (`…pooler.supabase.com:5432`, user `postgres.<ref>`) — use for the app.

3. **Restore your data** from the local dump (this is you running it, so your Supabase
   password stays out of the chat). From the repo root:

   ```bash
   pg_restore --no-owner --no-privileges --no-comments \
     -d "postgresql://postgres:<DB_PASSWORD>@db.<ref>.supabase.co:5432/postgres" \
     ./poker_ledger_db
   ```

   - Benign errors like `must be owner of schema public` or extension comments are expected
     with `--no-owner`; ignore them. The tables, data, and RLS policies still restore.
   - If the direct host won't resolve (IPv6-only on some networks), use the **Session pooler**
     string here instead — it also works for `pg_restore`.

4. **Verify the restore** (should match: 11 users, 75 sessions, 578 player rows):

   ```bash
   psql "postgresql://postgres:<DB_PASSWORD>@db.<ref>.supabase.co:5432/postgres" -c \
     "select (select count(*) from auth_user) users,
             (select count(*) from ledger_session) sessions,
             (select count(*) from ledger_sessionplayer) players;"
   ```

> **No `migrate` needed at cutover** — the dump already contains the schema *and* the
> migration history. (Future schema changes: run `DATABASE_URL=<direct> python manage.py
> migrate` locally against Supabase.)

---

## Phase 2 — Vercel (app)

1. **Import the git repo** at https://vercel.com (New Project). It will pick up `vercel.json`.
   *(Account creation is yours.)*

2. **Set Environment Variables** (Production, and Preview if you use it):

   | Key | Value |
   |-----|-------|
   | `SECRET_KEY` | a fresh secret — `python -c "import secrets;print(secrets.token_urlsafe(64))"` |
   | `DEBUG` | `False` |
   | `DATABASE_URL` | the **Session pooler** string (port 5432), incl. password |
   | `FRONTEND_URL` | your canonical URL, e.g. `https://your-app.vercel.app` |
   | `CORS_ALLOWED_ORIGINS` | same canonical URL (optional; same-origin) |

   Notes:
   - `VERCEL=1` is set by the platform automatically → `IS_SERVERLESS` turns on
     (`CONN_MAX_AGE=0`, `.vercel.app` allowed, secure cookies).
   - Add a **custom domain**? Put it in `ALLOWED_HOSTS` and `FRONTEND_URL` too.

3. **Deploy.** First deploys of a Django-on-Vercel app sometimes need one tweak — see
   Troubleshooting below.

---

## Phase 3 — Verify & cut over

1. Open the Vercel URL → sign up / log in (email + password). Auth uses `/_allauth/*`
   same-origin, so no cross-site cookie issues.
2. Confirm a user only sees their own tables (isolation).
3. Point your custom domain at Vercel if you have one.
4. **Decommission Render** once you're happy (delete the Render Postgres last, after a
   final check — though you already hold the dump).

---

## Notes & known gaps

- **No social login to reconfigure.** `allauth.socialaccount` isn't installed — auth is
  email/password only. Nothing to update for Google/OAuth redirect URIs.
- **Django admin CSS** (`/static/admin/…`) needs `collectstatic` output bundled into the
  function; it isn't wired up. The main app doesn't use `/static` (Vite assets live at
  `/assets`), and your users aren't staff, so this is cosmetic. Wire it up later if you
  want the admin.
- **Redis cache** is optional and off by default (falls back to in-memory). Leave `REDIS_URL`
  unset, or use Upstash if you want a shared cache across serverless instances.
- **RLS as a real second layer (optional hardening).** The app connects as Supabase's
  `postgres` superuser, which *bypasses* RLS — so isolation currently rests on Django's
  `get_queryset` owner filters (which are solid). To also enforce RLS at the DB, create a
  dedicated non-superuser role and connect as it. Not required for correctness; ask if you
  want this set up.

### Troubleshooting first deploy
- **`ModuleNotFoundError: config`** → `includeFiles: "backend/**"` in `vercel.json` bundles
  the Django code; confirm it's present.
- **Function timeout / slow first hit** → cold start + pooler handshake. `maxDuration` is 30s
  in `vercel.json`; lower if your plan rejects it.
- **CSRF 403 on login** → make sure `FRONTEND_URL` matches the exact URL in the browser bar
  (scheme + host).
- **Empty data / intermittent missing rows** → you're on the **Transaction pooler**. Switch
  `DATABASE_URL` to the **Session pooler** (see the rule above).
