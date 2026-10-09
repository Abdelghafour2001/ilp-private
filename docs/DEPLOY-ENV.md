# Deployment environment variables (dev / UAT)

Every setting the platform reads, what happens if you leave it out, and what it
should be on a shared environment. Source of truth: `backend/app/core/config.py`
(the `Settings` class), `backend/scripts/entrypoint.sh` and the frontend's
`/api` proxy route.

Four processes share one configuration: **backend** (FastAPI), **worker** and
**beat** (Celery), and **frontend** (Next.js). The frontend needs exactly one
variable; everything else below is for the three Python processes.

> **podman-compose caveat.** Unlike `docker compose`, it does not expand the
> default half of `${VAR:-default}` — it forwards the literal string. The
> backend blanks out such leftovers so the declared default applies, but set the
> values explicitly rather than relying on that.

---

## 1. Required — the deployment does not work without these

| Variable | Set on | Example | Why |
|---|---|---|---|
| `DATABASE_URL` | backend, worker, beat | `postgresql+psycopg2://aida:…@aida-db:5432/aida` | PostgreSQL. No managed-service default; the local default points at localhost:5433. |
| `REDIS_URL` | backend, worker, beat | `redis://aida-redis:6379/0` | Celery broker and result backend. Without it the scheduled jobs never run. |
| `CREDENTIALS_ENCRYPTION_KEY` | backend, worker, beat | 44-char urlsafe base64 | Encrypts stored provider credentials at rest. Generate with `python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"`. **Same value on all three** or one process cannot read what another wrote. Rotating it invalidates every stored credential. |
| `FRONTEND_ORIGIN` | backend | `https://aida-uat.example.com` | The single allowed CORS origin. A wrong value here is the classic "the UI loads but every call fails" symptom. |
| `BACKEND_URL` | **frontend** | `http://aida-backend:8000` | The only frontend variable. Read at runtime by the `/api/[...path]` proxy, so it is not baked into the image. |

## 2. Required on any shared environment — security

| Variable | Set on | Value | Why |
|---|---|---|---|
| `ADMIN_TOKEN` | backend, worker, beat | 24+ random characters | Gates the admin and HR APIs. The startup report warns when it is short. |
| `REQUIRE_ADMIN_AUTH` | backend | `1` | Refuses the "nothing configured = open API" fallback. **Set this on dev and UAT.** The HR payload carries matricules, BUs and job levels; without it an unauthenticated caller can read them. |
| `AUTH_METHODS` | backend | `sso,password` | Which sign-in doors are offered. `sso`, `password`, or both separated by a comma. Empty falls back to whatever is configured — `PASSWORD_LOGIN` plus the Azure pair — so existing deployments are unaffected. A method listed but not configured stays shut and is named in the start-up `sign-in` check rather than shown as a button that refuses. |
| `AZURE_TENANT_ID` | backend | tenant GUID | Entra ID SSO. Both this *and* the client id must be set, or the app falls back to the demo handle login with no authentication at all. |
| `AZURE_CLIENT_ID` | backend | app registration GUID | As above. The frontend fetches these from `GET /api/auth/config` at runtime — there is nothing to set on the frontend and nothing baked at build time. |
| `AZURE_CLIENT_SECRET` | backend | *(empty)* | Set it and the **server** runs the sign-in (OIDC code flow, `/api/auth/sso/azure`) instead of MSAL in the browser. The app registration is then an ordinary **Web** app whose redirect URI is `<FRONTEND_ORIGIN>/api/auth/sso/azure/callback` — no single-page-application URI, no client id in the page. Also needs `CREDENTIALS_ENCRYPTION_KEY`. |
| `ADMIN_EMAILS` | backend | `a@x.ma,b@x.ma` | Comma-separated admins, in addition to anyone holding the `admin` App Role in Azure. On the redirect flow this is also what promotes an account on first sign-in. |

SSO redirect URI (SPA) in the app registration must be the deployed frontend
origin, e.g. `https://aida-uat.example.com`.

## 3. Startup behaviour — one per environment

| Variable | Default | Set it to |
|---|---|---|
| `RUN_DB_MIGRATIONS_ON_START` | `true` | `true` on **backend only**; `false` on worker and beat. Three processes racing `alembic upgrade head` on boot is how a migration half-applies. |
| `AUTO_SEED` | `0` | `1` **once** on a fresh dev database to load demo content; `0` on UAT. It runs `app.seed_all` after migrating. |
| `STARTUP_DIAGNOSTICS_ENABLED` | `true` | `true` — each process logs a dependency report (database, Redis, SMTP, AI, SSO) before serving, which turns most deployment failures into one readable line. |
| `DIAGNOSTICS_LLM_CALLS` | `true` | `true` on dev, your call on UAT: it spends a few tokens on one real request to prove the key and model work. |

## 4. Email — needed for invitations, reminders and digests

| Variable | Default | Notes |
|---|---|---|
| `SMTP_HOST` | *(empty)* | **Empty disables email silently.** Assignments and session invites are then in-app only. Point it at the corporate relay, or at Mailpit on dev. |
| `SMTP_PORT` | `1025` | `1025` for Mailpit; `25`/`587` for a real relay. |
| `MAIL_FROM` | `UpSkill <aida@localhost>` | Must be a sender your relay accepts, e.g. `UpSkill <aida@teal.ma>`. Ignored on the Graph transport, which sends as `GRAPH_MAILBOX` and cannot be told otherwise. |
| `MAIL_ALLOWLIST` | *(empty)* | **Non-production safety.** Comma-separated addresses, or a domain as `@example.com`. When set, mail to anybody else is dropped and logged — in-app notifications are unaffected. Dev and UAT carry the real organisation and a real transport, and the nightly sweep cannot tell it is not production. Empty in production. |
| `GRAPH_TENANT_ID` | *(empty)* | Send through Microsoft Graph instead of SMTP. All four `GRAPH_*` must be set; then `mail_transport` is `graph` and `SMTP_HOST` is not read. |
| `GRAPH_CLIENT_ID` | *(empty)* | App registration with the **application** permission `Mail.Send`, admin-consented. Delegated `Mail.Send` does not work — there is no signed-in user in a nightly job. |
| `GRAPH_CLIENT_SECRET` | *(empty)* | Secret for that registration. A secret, not a certificate; certificate auth is a change in `app/core/graph.py`. |
| `GRAPH_MAILBOX` | *(empty)* | The mailbox mail is sent as, e.g. `upskill@teal.ma`. Ask the tenant admin for an application access policy restricting the app to it — `Mail.Send` as an application permission can otherwise send as anyone. |

## 5. Coursera — the enterprise sync

| Variable | Default | Notes |
|---|---|---|
| `COURSERA_MODE` | `off` | `off` disabled · `mock` fixtures, enough to demo the whole HR pipeline without a contract · `live` the real API. |
| `COURSERA_CLIENT_ID` | — | Required when `live`. |
| `COURSERA_CLIENT_SECRET` | — | Required when `live`. |
| `COURSERA_ORG_ID` | — | Required when `live`. Without a Coursera for Business contract the API answers 403. |

The **public catalogue** import (Admin → Coursera) needs no credentials and
works in any mode.

## 6. AI — pick one provider

Leave `LLM_PROVIDER` blank to auto-pick: Anthropic if a key is set, else Azure
OpenAI if configured, else Ollama.

| Variable | Notes |
|---|---|
| `LLM_PROVIDER` | `anthropic` · `azure_openai` · `ollama`, or blank to auto-pick. |
| `ANTHROPIC_API_KEY` | Anthropic path. |
| `AI_MODEL` | Default `claude-opus-4-8`. |
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_DEPLOYMENT` | Azure path. `DEPLOYMENT` is a deployment name, not a model id. |
| `AZURE_OPENAI_API_VERSION` | Default `2024-10-21`. |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Local path. In a container, the host is `http://host.docker.internal:11434`. |

AI is optional: with none of these configured, the written commentary on reports
falls back to computed sentences and every other feature is unaffected.

## 7. Business settings — defaults are sane, override if the client disagrees

| Variable | Default | Notes |
|---|---|---|
| `HOURS_PER_MAN_DAY` | `8` | Hours in one man-day for the Jour-Homme figures. Conventions vary (7, 7.5, 8), so it is configured rather than assumed. |
| `CERT_REMINDER_DAYS` | `60` | Days before a certificate expires that the renewal reminder goes out. Needs `worker` + `beat` running. |
| `UPLOADS_DIR` | `uploads` | Certificate files and session decks. **Must be a persistent volume** — a container restart otherwise loses every uploaded certificate. |
| `LABS_DIR` | `labs` | Contributor-authored lab definitions (`*.yaml`), read-only. |

---

## Minimal UAT set, copy-paste

```bash
# --- data ---
DATABASE_URL=postgresql+psycopg2://aida:CHANGEME@aida-db:5432/aida
REDIS_URL=redis://aida-redis:6379/0
CREDENTIALS_ENCRYPTION_KEY=          # generate, same on backend+worker+beat

# --- who may call what ---
FRONTEND_ORIGIN=https://aida-uat.example.com
ADMIN_TOKEN=                         # 24+ random characters
REQUIRE_ADMIN_AUTH=1
AUTH_METHODS=sso,password
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
ADMIN_EMAILS=

# --- startup (backend; set RUN_DB_MIGRATIONS_ON_START=false on worker/beat) ---
RUN_DB_MIGRATIONS_ON_START=true
AUTO_SEED=0
STARTUP_DIAGNOSTICS_ENABLED=true
DIAGNOSTICS_LLM_CALLS=true

# --- email ---
SMTP_HOST=
SMTP_PORT=587
MAIL_FROM=UpSkill <aida@teal.ma>

# --- Coursera ---
COURSERA_MODE=off                    # mock for a demo, live with the contract
COURSERA_CLIENT_ID=
COURSERA_CLIENT_SECRET=
COURSERA_ORG_ID=

# --- AI (optional) ---
LLM_PROVIDER=
ANTHROPIC_API_KEY=
AI_MODEL=claude-opus-4-8

# --- business ---
HOURS_PER_MAN_DAY=8
CERT_REMINDER_DAYS=60
```

And on the frontend container, alone:

```bash
BACKEND_URL=http://aida-backend:8000
```

## Difference between dev and UAT

| | dev | UAT |
|---|---|---|
| `REQUIRE_ADMIN_AUTH` | `1` (it is still shared) | `1` |
| `AUTO_SEED` | `1` on first boot | `0` |
| `COURSERA_MODE` | `mock` | `live`, or `off` until the contract is in place |
| `SMTP_HOST` | Mailpit | the corporate relay |
| SSO | optional — the handle login is enough | required |
| `DIAGNOSTICS_LLM_CALLS` | `true` | `true` unless the token spend is being watched |

## What is *not* configurable, and matters

- **The frontend has no build-time configuration.** `BACKEND_URL` is read per
  request and SSO comes from `/api/auth/config`, so one image serves every
  environment. Do not bake a `NEXT_PUBLIC_*` variable in; nothing reads one.
- **`UPLOADS_DIR` needs a volume.** It is the only state outside PostgreSQL.
- **Migrations run on the backend only.** Set `RUN_DB_MIGRATIONS_ON_START=false`
  everywhere else, or run them as a Job and set it `false` everywhere.
