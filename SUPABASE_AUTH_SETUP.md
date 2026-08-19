# Supabase Auth setup

This app now uses **Supabase Auth** for login/signup/passwords, while **Django
stays** as the API + business logic. Django no longer runs django-allauth
sessions; instead it verifies the Supabase access token (a Bearer JWT) on every
`/api/` request and maps the identity onto a Django user.

- **Frontend** logs in with `@supabase/supabase-js` and sends the token as
  `Authorization: Bearer <jwt>`.
- **Backend** verifies it in `config/authentication.py`
  (`SupabaseJWTAuthentication`) using the project's HS256 JWT secret.
- **Existing data is preserved**: the first time a returning user signs in, the
  backend links their Supabase identity to their existing Django user **by
  email**, so all their tables/sessions/history stay attached. See
  [Existing users](#existing-users).

---

## 1. Supabase dashboard

You already have a Supabase project (it hosts the Postgres database). In that
same project:

1. **Enable the Email provider** — Authentication → Providers → **Email** → on.
2. **Require email confirmation** — in the Email provider settings, turn on
   **"Confirm email"**. New users must click the emailed link before they can
   sign in.
3. **Set URLs** — Authentication → URL Configuration:
   - **Site URL**: your production app URL (e.g. `https://<app>.vercel.app`).
   - **Redirect URLs**: add each origin you sign in from, e.g.
     `http://localhost:5173`, `http://127.0.0.1:5173`, and your Vercel
     production/preview URLs. The confirmation link redirects here and drops the
     user straight into a signed-in session.
4. **Email sending** — the built-in Supabase mailer is rate-limited (a handful
   per hour, for testing only). For real use, set a custom SMTP provider under
   Authentication → Emails → **SMTP Settings**. For a small friends group you
   can start on the built-in mailer and add SMTP later.

## 2. Keys → environment variables

From **Project Settings → API**:

| Value | Goes in | Variable |
|---|---|---|
| Project URL | frontend + Vercel | `VITE_SUPABASE_URL` |
| `anon` / publishable key | frontend + Vercel | `VITE_SUPABASE_ANON_KEY` |
| JWT Settings → **JWT Secret** (legacy HS256) | backend `.env` + Vercel | `SUPABASE_JWT_SECRET` |

- **Backend** (`.env`, and Vercel env for the Python function): `SUPABASE_JWT_SECRET`.
- **Frontend** (`frontend/.env.local`, and Vercel env for the build):
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

See `.env.example` and `frontend/.env.example` for the annotated templates.

> The JWT secret and service-role key are **server-side only** — never put them
> in a `VITE_` variable. The frontend uses the anon key exclusively.
>
> This uses the project's **legacy HS256 JWT secret**. If your project has
> switched to asymmetric ("JWT signing keys") verification and no longer exposes
> an HS256 secret, tell me and I'll switch the verifier to JWKS.

## 3. Database migration

One additive migration adds `ledger_ledgeruser.supabase_id` (nullable) — the
stable Supabase↔Django link. It has already been applied to the current
database. For any other environment:

```bash
cd backend && python manage.py migrate
```

## 4. Local dev

```bash
# backend
cd backend && python manage.py runserver
# frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Make sure `SUPABASE_JWT_SECRET` (backend `.env`) and the two `VITE_SUPABASE_*`
vars (`frontend/.env.local`) are set first, or login and API calls will fail.

## Existing users

Everyone re-creates their account in the new Supabase login screen. When a
returning user signs up **with the same email** they used before:

1. They confirm their email (required — see step 1).
2. On their first signed-in request, `SupabaseJWTAuthentication` finds the
   existing Django user with that email, links it to their Supabase id, and
   returns it — so **all of their existing tables, sessions, and settlements are
   still there**.

Caveats:
- The email must match (case-insensitive). A different email → a fresh, empty
  account.
- Old Django passwords are irrelevant now; passwords live in Supabase.
- django-allauth is left installed but unused; the `/api/` layer only accepts
  Supabase tokens, so the old session path can't authenticate API calls.
