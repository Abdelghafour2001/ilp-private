# Secrets

## What happened

`.env` was committed to this repository and is still tracked on `origin/main`
(931 bytes, blob `3f15df2`). It carries real values. Anyone who has ever cloned
this repo — or who can read it on the server — has them, and `git log` keeps
them even after the file is deleted.

`feature/cr-managem-gaps` untracked the file in `59e649e` and `.gitignore`
covers `.env`, so **merging this branch to main stops the leak going forward**.
It does not undo it: the values remain in history and must be treated as
compromised.

## The surprise: most of them are not used

Grepping the codebase for every key in `.env` gives this:

| Key | Referenced in code | What to do |
|---|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | `core/config.py`, `core/security.py`, `seed_demo.py` | **Rotate.** See below — rotating it invalidates stored credentials. |
| `AZURE_CLIENT_ID` | `core/config.py` | Not a secret. Public by design; the browser receives it from `/api/auth/config`. |
| `AZURE_TENANT_ID` | `core/config.py` | Not a secret. Same. |
| `ADMIN_TOKEN` | compose, admin routes | **Rotate.** It is a full-access server credential. |
| `AZURE_CLIENT_SECRET` | *nowhere* | Rotate in Entra, then **delete from `.env`.** |
| `AZURE_SECRET_ID` | *nowhere* | Delete. This is the *identifier* of a secret, not the secret. |
| `GOOGLE_CLIENT_ID` | *nowhere* | Delete. UpSkill has no Google sign-in. |
| `GOOGLE_CLIENT_SECRET` | *nowhere* | Rotate in Google Cloud, then delete. |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | *nowhere* | Delete. Vestigial; the app has no password login. |
| `COURSERA_APP_ID` | *nowhere* | Delete. `COURSERA_CLIENT_ID` / `_SECRET` are the ones used. |

The Azure one is worth dwelling on. UpSkill signs users in with **MSAL in the
browser** — a public client. A public client has no way to keep a secret, which
is exactly why the OAuth flow it uses does not involve one. So
`AZURE_CLIENT_SECRET` was never needed here. If the same app registration is
shared with another project, rotating it will affect that project; if it is
not, the secret can simply be removed from the registration.

## Rotation order

Do these in order — two of them will sign people out.

1. **`ADMIN_TOKEN`** — generate a new one, set it in the deployment environment,
   restart the backend. Anything using the old one (scripts, the admin console)
   needs the new value.

2. **`CREDENTIALS_ENCRYPTION_KEY`** — read carefully before changing it. It
   encrypts stored connection credentials (`core/security.py`). Changing it does
   not migrate them: existing encrypted values become undecryptable, so any
   saved database connection must be re-entered afterwards. On a demo instance
   that is fine. On anything with real saved connections, decrypt-then-re-encrypt
   before swapping the key.

3. **`AZURE_CLIENT_SECRET`** — Entra portal → App registrations → the app →
   Certificates & secrets → new client secret, delete the old one. Then remove
   the key from `.env`; nothing here reads it.

4. **`GOOGLE_CLIENT_SECRET`** — Google Cloud console → APIs & Services →
   Credentials → reset. Then remove from `.env`.

5. **Delete the dead keys** listed above from `.env` and from any deployment
   environment. A secret that nothing reads is pure liability: it can leak but
   it cannot break anything by being absent.

## What is not fixed

The values stay in git history. Removing them means rewriting history
(`git filter-repo --path .env --invert-paths`) and force-pushing, which breaks
every existing clone — everyone has to re-clone or hard-reset. That was
deliberately **not** done here. Rotation is what actually protects you; a
history rewrite only reduces how easy the old values are to find, and it is
worth the disruption only if the repository is about to become visible to a
wider audience than the people who already have it.

## Keeping it from happening again

`.gitignore` covers `.env`, and `.env.example` documents every key the code
actually reads (verified: no key used by the code is missing from it, and the
example carries no real values). Before adding a key to `.env`, add it to
`.env.example` with an empty value, so the next person knows it exists without
needing the secret itself.
