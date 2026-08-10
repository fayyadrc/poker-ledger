# Django → Supabase migration audit

**Question:** Can Supabase replace the Django backend entirely, or must Django remain?
**Scope:** analysis only — no code changed, nothing migrated.
**Basis:** the actual codebase (`backend/`, `frontend/`, `api/`, `exports/`), not generic assumptions.

---

## 0. Headline finding (read this first)

**The $0/month goal is already met — with Django still in place.** The repo already contains a
committed serverless deployment (`api/index.py` wraps Django's WSGI app, `vercel.json` routes
`/api`, `/_allauth`, `/admin`, `/static` to it) targeting **Vercel Hobby (free) + Supabase Postgres
(free)**. See `MIGRATION.md`. Django-on-Vercel-serverless costs nothing.

So **removing Django is an optional simplification, not a requirement to hit $0.** That reframes the
whole decision: this is "do we want to shed the Python runtime?", not "we must, to save money."

**Verdict: PARTIALLY.** Most of the app is thin CRUD that Supabase + RLS can serve directly. But a
small, load-bearing core (settlement computation, balance-validated session close/adjust, atomic JSON
import, and a tamper-resistant audit trail) cannot safely live in the React client — it must move to
**Supabase Edge Functions and/or Postgres functions + triggers**. And the biggest cost is not the API
at all: it's **re-keying auth from integer Django user IDs to Supabase UUIDs** across live data, plus
**password resets for all 11 users** (Django `pbkdf2_sha256` hashes are not importable into Supabase Auth).

Recommended path: **Option C (keep Django on serverless) as the default**, with an optional
**Option B strangler** later if shedding Python is genuinely wanted.

---

## 1. Current architecture

```
React SPA (Vite 5, React 19, TanStack Query, react-router 7)
  │  fetch(), credentials: "include", X-CSRFToken from cookie
  ▼
Django 6.0 + DRF 3.15  (single app: "ledger")
  ├─ django-allauth[headless]  → email/password, session cookies
  ├─ SessionAuthentication (DRF)
  ├─ SetRLSUserMiddleware       → set_config('app.current_user_id', <pk>, FALSE)
  ├─ django-redis (optional; falls back to in-memory)
  ▼
PostgreSQL  (Row-Level Security already enabled: migrations 0013, 0015)
```

- **Deployment:** already serverless. `api/index.py` (Vercel Python) → `config.wsgi.application`;
  static SPA served from `backend/static/frontend`. Also has legacy `render.yaml`, `Dockerfile`,
  `railway.json`.
- **One Django app** (`ledger`) — no other apps beyond Django/allauth built-ins.
- **No** Celery, background workers, cron/scheduled jobs, signals, custom management commands, email
  sending, external HTTP calls, or AI/ML. Verified by grep across `backend/`.
- **Caching:** per-viewer read caching in Redis/locmem, with explicit cross-viewer invalidation
  (`ledger/cache_utils.py`).
- **Production data (from `exports/poker_ledger_supabase.sql`):** 11 users, 4 tables, 76 sessions,
  585 session-players, 467 settlements, 126 audit entries, 4 memberships. Small but real.

---

## 2. Complete API endpoint inventory

DRF routers + explicit `APIView`s. Auth column = "does it require a logged-in user?".
"Owner-only" = enforced in `get_queryset`/`_require_owner` (members/strangers get 404/403).

### `ledger` API (`/api/…`)

| Endpoint | Method | Purpose | DB ops | Auth | Complex logic? | Supabase replacement |
|---|---|---|---|---|---|---|
| `/api/tables/` | GET | List owned + joined tables (cached) | SELECT (join memberships) | Yes | No | **RLS SELECT** (client) |
| `/api/tables/` | POST | Create table + member names | INSERT ×N (txn) | Yes | Light | RLS INSERT; members in one call |
| `/api/tables/{id}/` | GET | Retrieve table (cached) | SELECT | Yes | No | **RLS SELECT** |
| `/api/tables/{id}/` | PUT/PATCH | Update table; replace members | UPDATE + DELETE/INSERT | Owner | Light | RLS UPDATE (+members) |
| `/api/tables/{id}/` | DELETE | Delete table (cascade) | DELETE | Owner | No | RLS DELETE |
| `/api/tables/{id}/sessions/` | GET | List sessions for table (cached) | SELECT + prefetch | Yes | No | **RLS SELECT** |
| `/api/tables/{id}/sessions/` | POST | Start session + players + audit | INSERT ×N + audit | Owner | **Yes** | **Edge Function** (or PG fn) |
| `/api/tables/{id}/share-link/` | GET/POST/DELETE | Read/rotate/revoke share token | SELECT/UPDATE | Owner | Light (secrets) | RLS UPDATE or tiny Edge Fn |
| `/api/tables/{id}/memberships/` | GET | List viewers | SELECT | Owner | No | RLS SELECT |
| `/api/tables/{id}/memberships/{mid}/` | DELETE | Remove a viewer | DELETE | Owner | No | RLS DELETE |
| `/api/tables/{id}/leave/` | POST | Viewer leaves table | DELETE | Yes | No | RLS DELETE |
| `/api/tables/{id}/requests/` | GET | List change requests (scoped) | SELECT | Yes | No | RLS SELECT |
| `/api/tables/{id}/requests/` | POST | Raise change request + audit | INSERT + audit | Yes | Light | RLS INSERT (+ audit trigger) |
| `/api/tables/{id}/requests/{rid}/resolve/` | POST | Resolve/reject request + audit | UPDATE + audit | Owner | Light | Edge Fn or RLS UPDATE + trigger |
| `/api/sessions/{id}/` | GET | Session detail (cached) | SELECT + prefetch | Yes | No | **RLS SELECT** |
| `/api/sessions/{id}/` | PATCH | Edit session date + audit | UPDATE + audit | Owner | Light | RLS UPDATE + audit trigger |
| `/api/sessions/{id}/` | DELETE | Delete session | DELETE | Owner | No | RLS DELETE |
| `/api/sessions/{id}/audit-log/` | GET | Read audit entries | SELECT | Yes (member) | No | RLS SELECT |
| `/api/sessions/{id}/buy-in/` | POST | Add to a player's buy-in + audit | UPDATE + audit | Owner | Light | Edge Fn or RLS UPDATE + trigger |
| `/api/sessions/{id}/add-player/` | POST | Add player mid-session + audit | INSERT + audit | Owner | Light | RLS INSERT + audit trigger |
| `/api/sessions/{id}/complete/` | POST | **Close session: validate balance, set cash-outs, compute settlements, audit** | UPDATE ×N + bulk INSERT (txn) | Owner | **Yes** | **Edge Function** (or PG fn) |
| `/api/sessions/{id}/adjust/` | POST | **Rewrite amounts on a completed session, recompute settlements, audit** | UPDATE ×N + bulk INSERT (txn) | Owner | **Yes** | **Edge Function** (or PG fn) |
| `/api/me/` | GET | Get/create user prefs | SELECT/INSERT | Yes | No | RLS SELECT + upsert |
| `/api/me/` | PATCH | Update prefs (validated) | UPDATE | Yes | Light (validation) | RLS UPDATE + CHECK constraints |
| `/api/me/ingest/` | POST | **Bulk import tables/sessions/transfers with player merge + settlements + audit** | Many INSERT (single txn) | Yes | **Yes** | **Edge Function** |
| `/api/shared/{token}/` | GET | Public read-only table + sessions by token | SELECT | **No** (AllowAny) | Medium | **Edge Fn** or anon RLS + RPC |
| `/api/shared/{token}/join/` | POST | Redeem share link → viewer membership | get_or_create | Yes | Light | Edge Fn or RLS INSERT |
| `/api/health/` | GET | Health check | none | No | No | Drop (platform health) |

### Auth API (`django-allauth` headless) — `/_allauth/browser/v1/…`

| Endpoint | Method | Purpose | Replacement |
|---|---|---|---|
| `/config` | GET | Auth config | Supabase Auth client |
| `/auth/session` | GET | Current session | `supabase.auth.getSession()` |
| `/auth/session` | DELETE | Logout | `supabase.auth.signOut()` |
| `/auth/login` | POST | Email/password login | `signInWithPassword()` |
| `/auth/signup` | POST | Register | `signUp()` |
| `/admin/…` | — | Django admin (staff only; CSS not wired on serverless) | Supabase Studio / drop |

**Totals:** ~27 REST endpoints in `ledger`, 5 auth endpoints used by the client, plus admin.
Of the 27, **~19 are pure CRUD/read** (Category A/B) and **~4 carry real server-side logic**
(sessions POST, complete, adjust, ingest), with the rest being light mutations that want an audit
side-effect.

---

## 3. Django feature inventory & categorisation (A–E)

### Category A — Supabase can replace directly (client → PostgREST)
- Table list/retrieve, session list/retrieve, session detail — all reads.
- Create/update/delete table, delete session, add player, membership list/remove/leave.
- Prefs read (`GET /me`) and update (`PATCH /me`).
- Change-request list/create.
- Auth: login, signup, logout, session — all map to Supabase Auth.

### Category B — Supabase can replace with RLS
The app's authorization model is **exactly** the RLS sweet spot, and it is **already implemented in
Postgres** (migrations 0013 + 0015):
- *Owner sees/edits only their own tables* → `rls_owner_isolation` (`owner_id = current_user`).
- *Viewers (joined via share link) can read but not write* → `rls_member_read`, child
  `rls_shared_read` policies; writes excluded.
- *Anonymous holder of a share token can read one table* → `rls_share_token_read` keyed on
  `app.share_token`.
- *Admin/migrations bypass* → `rls_bypass_for_admin`.

**Caveat that dominates the migration (see §4/§7):** these policies key on an **integer** session
variable (`app.current_user_id`) set by Django middleware — *not* `auth.uid()` (a UUID). Reusing them
under Supabase Auth requires rewriting every policy and re-keying every user column.

### Category C — Supabase Edge Function
Endpoints doing real server-side work that must not be trusted to the client:

1. **`POST /sessions/{id}/complete/`** — reads all players, sums buy-ins vs cash-outs, **rejects if
   unbalanced** unless `allow_discrepancy`, writes cash-outs, flips `is_completed`, **computes the
   minimal settlement set** (`settlement.compute_settlements`), persists it, writes an audit entry.
   *Inputs:* `{cash_outs:[{player_id,cash_out}], allow_discrepancy}`. *Returns:* session detail.
   *Secrets:* service-role key (server-side only). *External APIs:* none.
2. **`POST /sessions/{id}/adjust/`** — same shape for a *completed* session: validate every player
   present, recompute settlements, audit the before/after diff.
3. **`POST /me/ingest/`** — bulk import: canonicalise player names, **merge duplicate players within a
   session**, create table+members+transfers+sessions+players in **one transaction**, compute
   settlements per session, audit each. *Inputs:* nested `{tables:[…]}`. *Returns:* summary counts.
4. **`POST /tables/{id}/sessions/`** — create a session with initial players/buy-ins + audit.
5. *(thin)* buy-in, add-player, date-change, request create/resolve — could be Edge Functions purely
   to keep the audit write server-side, or handled by DB triggers (Category D).

Why an Edge Function works: all four are short, synchronous, no long-running/CPU-heavy work, no
Python-only libraries — the settlement algorithm is ~40 lines of decimal arithmetic that ports cleanly
to TypeScript. Well within Edge Function limits.

### Category D — PostgreSQL function / trigger
- **Audit trail** (`SessionAuditEntry`): today every mutation calls `log_session_audit`. To keep the
  trail tamper-resistant *without* a server, model it as **`AFTER INSERT/UPDATE/DELETE` triggers**
  writing audit rows, with the audit table's RLS allowing **no client writes/updates**. This is the
  single best use of Category D here.
- **`updated_at`/`created_at`** (`auto_now`/`auto_now_add`): replace with column `DEFAULT now()` and a
  `BEFORE UPDATE` touch trigger.
- **Settlement recompute**: *could* be a PG function invoked by the Edge Function (keeps decimal logic
  in one place next to the data), but a trigger is a poor fit because it needs the "reject unbalanced"
  decision, which belongs in the request path.
- Currency/sort/chip validation (`serializers.py`): move to `CHECK` constraints + a small domain table.

### Category E — Must remain Django/Python
Nothing is *intrinsically* Python-bound. There is **no** ML, no Python-only library, no long-running
process, no OS/Python integration. Everything Django does here is either (a) framework-provided
plumbing (routing, serialization, session auth) or (b) ~4 pieces of portable business logic.

**Consequence:** "Django the framework" *can* reach zero — but only by relocating that plumbing and
logic into Supabase (Auth + RLS + Edge Functions + triggers). A **trusted server-side execution layer
does not disappear; it moves.** The question is whether re-implementing it in Deno/SQL is worth it
when the Django version already runs free.

---

## 4. Authentication analysis

**Today:**
- `django-allauth[headless]`, email + password, **`ACCOUNT_EMAIL_VERIFICATION = "none"`**.
- **Session-cookie** auth (DRF `SessionAuthentication`), CSRF via `X-CSRFToken` cookie/header.
- Default Django **`auth.User`** — **integer PK**. No custom user model, no social providers, no JWT,
  no refresh tokens.
- Passwords: **`pbkdf2_sha256$1200000$…`** for all 11 users (confirmed in the dump).

**Mapping to Supabase Auth:**
- Login/signup/logout/session map 1:1 to `supabase.auth.*`. Supabase issues **JWTs** (access +
  refresh) consumed by RLS via `auth.uid()`.
- **Two hard problems with live data:**
  1. **Identity type change (integer → UUID).** Supabase users are UUIDs. Every FK
     (`Table.owner_id`, `TableMembership.user_id`/`owner_id`, `ChangeRequest.requester_id`/`owner_id`,
     `LedgerUser.user_id`) and every RLS policy is integer-keyed. Migration must add UUID columns,
     backfill via an email→UUID map, repoint all FKs, and rewrite all policies to `auth.uid()`.
     `SessionAuditEntry.actor_id` is a free-text CharChar and would hold stale integer ids.
  2. **Password hashes are not portable.** Supabase Auth (GoTrue) stores bcrypt; Django stores
     `pbkdf2_sha256`. You cannot import the existing hashes. All 11 users must **reset their password**
     (invite/reset email flow), or you pre-create users with random passwords and force reset.

**Do not run two auth systems in parallel** (the brief's own rule). That means auth is an atomic
cutover, not a gradual one — which is the riskiest single step of a full migration.

---

## 5. Database / model analysis

Models (all in `backend/ledger/models.py`): `LedgerUser`, `Table`, `TableMembership`, `ChangeRequest`,
`TableMember`, `TableTransfer`, `Session`, `SessionPlayer`, `SessionSettlement`, `SessionAuditEntry`,
plus Django/allauth built-ins (`auth_user`, `account_*`, `django_session`, `django_site`, …).

- **Schema portability: excellent.** It's already vanilla Postgres (`DecimalField`→`numeric`,
  `JSONField`→`jsonb`, FKs, `unique_together`, indexes). The dump in `exports/` restores as-is; the
  schema needs **no** structural change to *run on* Supabase. (This is why `MIGRATION.md`'s
  keep-Django plan is a pure lift-and-shift.)
- **Django-specific behaviours to reproduce if Django is removed:**
  - `auto_now_add`/`auto_now` (`created_at`/`updated_at`) → `DEFAULT now()` + touch trigger.
  - `default_session_date` (localdate), `default_chip_values` (JSON list) → column defaults.
  - `save()`-adjacent logic lives in serializers/views, not model `save()` overrides — so it must be
    re-homed to Edge Functions/triggers, not just copied.
  - Cascade deletes (`on_delete=CASCADE`) → Postgres `ON DELETE CASCADE` (already in the dump).
  - Serializer-level validation (currency allow-list, chip values, message non-empty, balance rules)
    → `CHECK` constraints + Edge Function guards. **RLS does not validate payloads**, so this logic
    cannot simply vanish.
- **Tables tied to Django itself** (`django_session`, `django_migrations`, `django_content_type`,
  `auth_permission`, `account_emailaddress`, …) become dead weight if Django is removed; drop after
  cutover.

---

## 6. React → Django dependency analysis

- **Transport:** `frontend/src/lib/api.js` — a single `fetch` wrapper, `credentials:"include"`,
  `X-CSRFToken` from cookie (`lib/django.js`). No axios.
- **Auth client:** `frontend/src/lib/allauth.js` hits `/_allauth/browser/v1/*`; `AllauthAuthGate.jsx`
  gates routes on `getSession()`.
- **Data layer:** TanStack Query hooks in `frontend/src/lib/queries/*` (`tables.js`, `sessions.js`,
  `me.js`, `sharing.js`, `auth.js`) wrap the `*Api` objects. **This is the whole coupling surface** —
  every call goes through those files.
- **Already client-side (no Django dependency):** balance math (`lib/sessionBalance.js`), player stats
  (`lib/playerStats.js`), CSV/JSON export (`lib/tableExport.js`), session draft, sorting. Note the
  client **already re-derives nets** — but the *authoritative* settlement + balance gate is server-side,
  and must stay authoritative.

**Blast radius of removing Django:** rewrite `lib/api.js`, `lib/allauth.js`, `lib/django.js`, and the
5 `lib/queries/*` files to call `@supabase/supabase-js` (auth, `.from().select()`, `.rpc()`,
`.functions.invoke()`). Components mostly stay, since they consume Query hooks, not fetch directly. CSRF
handling disappears (JWT bearer instead).

---

## 7. Supabase replacement mapping (final)

| Existing Django functionality | Replacement | Remove Django? |
|---|---|---|
| Email/password auth, sessions | Supabase Auth (JWT) | Yes — but re-key users + reset passwords |
| Owner/viewer/share authorization | Supabase RLS (rewrite policies → `auth.uid()`) | Yes — rewrite, not reuse |
| Table/session/prefs reads | Supabase client + RLS | Yes |
| Create/update/delete CRUD | Supabase client + RLS (+ CHECK constraints) | Yes |
| Membership join/leave, share-token CRUD | Supabase client + RLS (or tiny RPC) | Yes |
| Change-request create/list/resolve | Supabase client + RLS (+ audit trigger) | Mostly |
| **Session complete (balance gate + settlements)** | **Edge Function** | Needs replacement |
| **Session adjust (recompute settlements)** | **Edge Function** | Needs replacement |
| **JSON ingest (atomic bulk import + merge)** | **Edge Function** | Needs replacement |
| Session create with players + audit | Edge Function or RLS INSERT + trigger | Needs replacement |
| Audit trail integrity | Postgres triggers (client-write-forbidden) | Needs replacement |
| `auto_now`/`auto_now_add`, defaults | Column defaults + touch trigger | Yes |
| Read caching (Redis) | Drop (PostgREST + CDN) or Supabase-side | Yes (drop) |
| Public shared view | Edge Function or anon RLS + RPC by token | Needs replacement |
| Django admin | Supabase Studio | Yes (drop) |
| Python ML / background jobs | **None exist** | N/A |

---

## 8. Features that need Edge Functions
`complete`, `adjust`, `ingest`, `sessions` (create), and the public `shared/{token}` read (to shape a
combined table+sessions payload and keep the token check server-side). All are short, synchronous,
secret-holding (service role), no external APIs. The settlement algorithm ports to ~40 lines of TS.

## 9. Features that need Django/Python
**None are Python-bound.** There is no ML, no Python-only dependency, no long-running or CPU-heavy work.
The realistic reasons to *keep* Django are pragmatic, not technical: it already exists, already runs at
$0, and already encodes the balance/settlement/ingest/audit logic that would otherwise be rewritten and
re-tested in Deno/SQL.

---

## 10. Security / RLS analysis
- **Isolation is already server-enforced** in Postgres — good. But under a full migration it must be
  **rewritten** to `auth.uid()` (UUID) and re-validated; a mistake here silently exposes other users'
  ledgers. The existing recursion-avoidance design (denormalised `owner_id` on membership/request,
  child `IN (SELECT id FROM parent)` policies) must be reproduced faithfully.
- **Payload validation ≠ RLS.** Currency allow-list, chip-value rules, non-empty messages, and the
  buy-in/cash-out **balance gate** are not authorization — RLS won't enforce them. They must land in
  Edge Functions and/or `CHECK` constraints, or clients could write invalid/unbalanced data.
- **Audit integrity:** if clients write directly (Category A), audit rows must come from **triggers**,
  and the audit table's RLS must forbid client INSERT/UPDATE/DELETE — otherwise the trail is forgeable.
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY` stays server-side (Edge Functions) only; the React app uses
  the **anon/publishable** key exclusively. Never ship the service-role key to the client.
- **`MIGRATION.md` note to correct:** it says the app connects as Supabase's `postgres` superuser,
  which **bypasses RLS**. That's fine while Django enforces `get_queryset` owner filters, but in a
  Django-removed world **RLS is the only guard** — you must connect as a non-superuser role for which
  `FORCE ROW LEVEL SECURITY` actually binds.

## 11. Migration difficulty

| Work item | Difficulty | Notes |
|---|---|---|
| Schema onto Supabase Postgres | **Easy** | Already Postgres; dump restores as-is |
| Reads/CRUD → client + RLS | **Moderate** | Mechanical, but per-endpoint |
| Rewrite RLS to `auth.uid()` | **Difficult** | Security-critical; recursion pitfalls |
| Re-key users integer→UUID on live data | **Difficult** | Backfill + repoint every FK |
| Password reset for all users | **Moderate** | Unavoidable; user-facing |
| Settlement/complete/adjust → Edge Fns | **Moderate** | Port + re-test decimal logic |
| Ingest → Edge Function | **Moderate–Difficult** | Atomicity + player merge |
| Audit as triggers | **Moderate** | Get integrity right |
| Rewrite React data/auth layer | **Moderate** | Contained to `lib/` |
| **Full Django removal, end-to-end** | **Difficult** | Sum of the above + atomic auth cutover |

## 12. Risks
- **Data exposure** from an RLS rewrite bug (highest severity).
- **Auth cutover is atomic** (no dual-auth allowed) — a bad cutover locks out all 11 users.
- **Lost/forged audit trail** if triggers/RLS are imperfect.
- **Settlement/balance regressions** — the Python has 85 tests (`tests.py`,
  `test_settlement_helpers.py`); a TS/SQL port starts at zero coverage until re-written.
- **Unbalanced/invalid writes** if validation isn't fully re-homed off the serializers.
- **Effort vs. benefit:** large rewrite for **$0 saved** (already free with Django).

## 13. Recommended architecture

**Default — Option C (keep Django, serverless):**
```
Vercel (React SPA + Django serverless via api/index.py)  →  Supabase Postgres (Session pooler, RLS)
```
Lowest risk, already committed, already $0. Supabase is used as the **database (and optionally Auth
later)**; Django stays as the thin, tested API + trusted-logic layer.

**If shedding Python is explicitly wanted — Option B (strangler, phased):**
```
React → Supabase Auth + client (reads/CRUD via RLS)
      → Supabase Edge Functions (complete, adjust, ingest, session-create, shared)
      → Postgres triggers (audit, timestamps) + CHECK constraints (validation)
      ↘ Django retired only after the 4 Edge Functions + RLS rewrite + auth re-key are proven
```

**Not recommended — Option A (rip Django out in one step):** concentrates the auth re-key, RLS
rewrite, logic port, and React rewrite into a single big-bang cutover on live data.

## 14. Step-by-step plan (only if pursuing Option B)
1. **Stay on Option C first** — deploy the already-built Vercel+Supabase setup so you're at $0 and
   stable *before* changing architecture. (`MIGRATION.md` Phases 1–3.)
2. **Harden RLS for real** — connect Django as a **non-superuser** role so `FORCE ROW LEVEL SECURITY`
   binds; confirm isolation holds with the DB, not just Django.
3. **Auth pilot** — stand up Supabase Auth, build the email→UUID user map, script the FK re-key on a
   *copy* of the dump; verify RLS-by-`auth.uid()` on the copy. Do **not** touch prod yet.
4. **Move reads** — repoint `lib/queries/*` reads to the Supabase client behind the new RLS (feature-
   flagged). Django still serves writes.
5. **Port logic to Edge Functions** — `complete` → `adjust` → `sessions.create` → `ingest` → `shared`.
   Re-implement the 85 tests against the Edge Functions before switching each one.
6. **Audit + validation to the DB** — triggers for audit/timestamps; CHECK constraints for currency,
   chip values, balance rules.
7. **Atomic auth cutover** — migrate users to Supabase Auth, force password resets, flip the frontend
   to Supabase JWT. This is the point of no return.
8. **Decommission Django** — remove `api/index.py`, `backend/`, drop Django-only tables. Keep the dump.

## 15. Final verdict

```
CAN DJANGO BE REMOVED COMPLETELY?

PARTIALLY
```

- **Nothing forces Django to stay** (no Python-only code), **but** it cannot be deleted as-is: ~4
  server-side operations (session **complete**, **adjust**, **ingest**, **create**) and a
  tamper-resistant **audit trail** must first be re-implemented as **Supabase Edge Functions +
  Postgres triggers**, and the **auth/RLS layer must be re-keyed from integer Django IDs to Supabase
  UUIDs** with **password resets for all 11 users**.
- **Smallest Django-or-equivalent surface that must exist after migration:** a trusted server-side
  execution layer for those 4 operations + audit — i.e. Django doesn't have to remain, but *something
  server-side does*; it just relocates into Supabase Edge Functions/PG functions.
- **Strategic recommendation:** since the app **already runs at $0 on Vercel serverless + Supabase
  Postgres with Django intact**, keep **Option C** now; pursue the **Option B strangler** only if
  removing the Python runtime is a deliberate goal worth a security-sensitive rewrite that saves no money.
```
```
