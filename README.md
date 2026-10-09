# UpSkill — AI & Data Academy

An **interactive learning academy for AI & data engineers** — learn by *doing*. Hands-on labs
(AI engineering, Python, JavaScript) are graded instantly on the server, with an AI tutor, XP, badges, and a leaderboard. A **Stacks** toolbox gives copy-paste
local setups for real tools — Kafka, dbt, Spark, Airflow, a Trino lakehouse, and the AI side
(Ollama, pgvector, Qdrant, MLflow, local RAG). Community-driven: add a lab or a stack with a
single YAML file.

Under the hood it's also a real **data quality tool** (the "Studio") — connect your own Postgres
and let the engine (and Claude or local Ollama) auto-generate checks, explain failures, and suggest
fixes. The labs and the Studio share the same check engine.

> The folder/repo is still named `DQ-AI` for now; the product is **UpSkill**.

## What's inside

| Area | What |
| ---- | ---- |
| **Formations** | Instructor-led trainings: trainers build modules mixing theory (articles, videos, quizzes) with **live GenAI practice** — prompt playgrounds run trainee prompts against the LLM, and prompt challenges are graded by an AI examiner against the trainer's rubric. Invitations, join codes, per-trainee progress & score dashboards, and **live sessions** (kickoffs, workshops) scheduled per formation. A **fiche formation** carries objectives, prerequisites, duration, delivery mode (présentiel / virtuel / hybride / e-learning), target skills, cost and whether the programme is **internal or bought from a provider**. Quizzes can be tagged as the **entry or exit evaluation**, and the trainer gets a before/after report showing each trainee's gain. A 2-step builder wizard: basics → curriculum studio with live trainee preview. Seed a real prompt-engineering formation with `python -m app.seed_formations`. |
| **Teams & roles** | Role system: `user`, `trainer`, `skill_lead`, `manager`, `hr` (HRBP), `admin`. An HRBP sees their own BU only — scoped server-side, not just filtered in the UI; L&D/admins get the consolidated view. **Skill Leads** (HR/skills responsibles) and each team's **manager** run the team from the `/team` dashboard — per-member XP, level, streak, badges, lab completions and formation progress, plus team totals; they add/remove members and **assign trainings** to the whole team or to individual members (assignees get an in-app notification + email and accept in-app). Admins create teams and appoint leads/managers by handle. |
| **Schedule** | One agenda across all formations: upcoming live sessions grouped by day, with trainer, room/meeting link, and the viewer's enrollment status. Plus **open sessions** anyone may register for — capacity, registration deadline, automatic waitlist with promotion on cancellation, and a register the trainer takes afterwards (the `présence` KPI). Every session exports as an **.ics** file for Outlook. |
| **Pathways** | Curated journeys chaining trainings, courses and certifications. A pathway is **mandatory or optional**, and so is each step; a step marked **milestone** gates everything after it until the required work before it is done — enforced server-side, so a locked step is not merely greyed out. Progress tracks the required spine, so optional extras cannot make a mandatory pathway read as complete. |
| **Certifications** | A shared catalog of external certifications (curated by trainers/leads/managers) — entries can be flagged **required by a client**, with a validity period that pre-fills a shared certificate's expiry and drives **automatic renewal reminders** (daily Celery sweep; client-required lapses escalate to the manager, Skill Lead and HR). Plus **team suggestions** ("this cert fits our team" — Skill Leads & managers only), and a public **earned wall**: anyone shares a certificate they obtained (PDF/image upload + credential link) so achievements stay visible. |
| **Courses** | Udemy-style learning paths mixing articles, videos, interactive labs, and quizzes — with per-learner progress. Anyone can publish one. |
| **Labs** | Guided lessons graded live — in-browser code labs (Python via Pyodide, JavaScript) with hidden-test grading, and multiple-choice concept checks. |
| **Stacks** | Copy-paste local setups for real tools (Kafka, dbt, Neo4j, Spark, Airflow, Trino+Hive+MinIO, DuckDB) + professional use cases. |
| **Challenges** | Open-innovation board — post a brief, submit ideas, upvote the best. |
| **Sharing Sessions** | Archive of team presentations — write-up + slide deck (PPTX/PDF) upload + recording link. |
| **Assets** | An internal hub to "assetize" AI/data work — share notebooks, code, models, datasets & ideas so they get reused, not lost. |
| **Gamification** | XP + levels, daily **streaks**, badges, **weekly quests**, a per-track **skill tree**, and a leaderboard (lightweight handle-based identity). |
| **AI features** | Provider-agnostic (Claude or local Ollama): tutor chat with streaming hints that don't spoil answers, AI-generated quizzes, code review for code labs, personalized learning-path recommendations, check suggestions, and failure explanations. |
| **Studio** | Connect your own Postgres, author suites, AI-suggest checks, run them. |
| **HR reporting** | The `/org` panel: heures de formation and **Jour-Homme**, completion rate, attendance rate, cost, feedback rate, and the internal/external split — sliced by BU, Practice, Location, Matricule and Job Level, and filterable by delivery mode and programme type. Exports as CSV, a formatted **Excel** workbook or a **PDF** report, all under the same BU scoping as the on-screen data. Learning time is *estimated* from completed work, so Jour-Homme inherits that caveat. |
| **Admin** | Manage everything: create/edit/publish labs in-app, reload file labs, manage learners, see platform stats. |

## Two ways to author labs

1. **File-based (curated)** — drop a YAML file in [`backend/labs/`](backend/labs) and open a PR.
2. **In-app (Admin → Manage labs)** — create/edit labs in a visual editor; they're stored in the
   DB and can be published/unpublished. Editing a file lab in the UI saves a DB copy that overrides
   the file. The admin API is gated by `ADMIN_TOKEN` (open if unset, for local dev).

## Core concepts

| Concept       | Meaning                                                            |
| ------------- | ----------------------------------------------------------------- |
| **Connection**| A data source (Postgres first; warehouses & files later).         |
| **Dataset**   | A table/view within a connection.                                 |
| **Check**     | A single data-quality rule (not-null, unique, range, freshness…). |
| **Suite**     | A named group of checks run together.                             |
| **Run**       | One execution of a suite against a dataset.                       |
| **Result**    | The outcome of one check within a run (pass/fail + metrics).      |

## Stack

- **Backend:** FastAPI, SQLAlchemy 2, Alembic, Celery + Redis, PostgreSQL (app metadata).
- **AI:** Anthropic Claude (`claude-opus-4-8` / `claude-sonnet-4-6`).
- **Frontend:** Next.js (App Router), TypeScript, Tailwind.

## Quick start (everything in Docker)

```bash
cp .env.example .env     # set CREDENTIALS_ENCRYPTION_KEY + choose an LLM (below)
docker compose up        # builds + runs db, redis, mailpit, backend, workers, frontend
```

### Load demo content (optional, recommended for demos)

Fill the app with dummy learners, courses, challenges (with submissions + votes),
assets, and sharing sessions (including a downloadable sample deck):

```bash
docker compose exec backend python -m app.seed_demo        # skips if data exists
docker compose exec backend python -m app.seed_demo --force # add anyway
```

Two more seeders build on it:

```bash
# A complete instructor-led formation (modules, playgrounds, AI-graded challenges)
docker compose exec backend python -m app.seed_formations

# An HR-presentation dataset: 2 teams with Skill Leads & managers, learners with
# varied XP/streaks/progress, 3 published formations, and a week of live sessions
# (--force re-applies and refreshes the sessions to the upcoming Monday)
docker compose exec backend python -m app.seed_demo_hr
```

(Running on the host instead of Docker: `python -m app.seed_demo` from `backend/`.)

The seeder also wires up two **Studio test databases** so you can try connecting to
external DBs and running checks:

| Connection | In Docker (host / port) | From the host (host / port) | db / user / pass |
| ---------- | ----------------------- | --------------------------- | ---------------- |
| Retail DB  | `retail-db` / `5432`    | `localhost` / `5435`        | retail / retail / retail |
| HR DB      | `hr-db` / `5432`        | `localhost` / `5436`        | hr / hr / hr     |

Both come up with `docker compose up` and are seeded with realistic relational
tables (and a few deliberate data-quality issues, so the AI suggestions and checks
find real problems). After seeding, they appear pre-connected under **Studio →
Connections** — pick a table, AI-suggest checks, and run.

### Platform roles

Every learner has a role, settable from **Admin → Manage learners** (or auto-granted
when an admin appoints them on a team):

| Role | Can do |
| ---- | ------ |
| `user` | Learn: labs, courses, formations, challenges. |
| `trainer` | Everything above + create/run formations, see rosters, schedule live sessions. |
| `skill_lead` | The HR/skills responsible of a team — `/team` dashboard, manage members, assign trainings. |
| `manager` | Same team powers as the Skill Lead, for the team they oversee. |
| `hr` | Org-wide people view: the `/org` graph of all managers & teams, plus full management of every team. |
| `admin` | Everything: teams, roles, labs, platform stats. |

### Sign-in (Azure SSO, optional)

By default, users pick a handle (no password) — fine for local/demo. To use
**Microsoft sign-in with admin/user roles**, set in `.env`:

```
AZURE_TENANT_ID=<your tenant GUID>
AZURE_CLIENT_ID=<app registration client id>
ADMIN_EMAILS=you@company.com   # and/or assign an "admin" App Role in Azure
```

In the Azure App Registration: add a **SPA redirect URI** of `http://localhost:3000`,
and (for role-based admin) define an **App Role** named `admin` and assign it to people.
When configured, the header shows **Sign in with Microsoft**; admins get access to the
Admin panel, everyone else is a regular user. Leave the vars blank to keep the simple
handle login.

### AI: bring a key **or** run Ollama (pick one)

The AI tutor, check-suggestions, and failure-explanations are provider-agnostic:

- **Claude (best quality)** — set `ANTHROPIC_API_KEY` in `.env`.
- **Ollama (free, local)** — install [Ollama](https://ollama.com), `ollama pull llama3.1`,
  and leave `ANTHROPIC_API_KEY` blank. The backend auto-detects Ollama and reaches it at
  `host.docker.internal:11434` from Docker.

Everything except the AI features works with neither configured.

That's it — migrations run automatically on backend boot. UI at
http://localhost:3000 · API docs at http://localhost:8000/docs.

In the UI: **Connections** → enter a PostgreSQL database the server can reach →
**Test & save**. Then create a suite on one of its tables, **✨ AI suggest checks**,
and **▶ Run**.

### Alternative: run backend/frontend on the host

Useful if you'd rather not rebuild images on every change. Run only the
datastores in Docker (`docker compose up -d app-db redis mailpit`), then:

```bash
cd backend && python -m venv .venv && source .venv/bin/activate  # win: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # set DATABASE_URL host to localhost:5433, plus secrets
alembic upgrade head && uvicorn app.main:app --reload

cd frontend && npm install && npm run dev
```

When the backend runs on the host, connect to the demo DB at `localhost:5434`.

## Contributing

New labs and stacks are just YAML files — no app code. See **[CONTRIBUTING.md](CONTRIBUTING.md)**
for the full step-by-step tutorial. Quick version below.

### Contributing a lab (no code required)

A lab is a single YAML file in [`backend/labs/`](backend/labs). Drop one in, open a PR.

```yaml
id: my-lab
title: My Lab
track: Fundamentals
difficulty: beginner
summary: One-line pitch.
dataset: { schema: public, table: customers }
steps:
  - id: intro
    type: concept            # concept | exercise | challenge
    title: Why this matters
    body_md: |
      Markdown explanation. Supports **bold**, `code`, > callouts, and - lists.
  - id: do-it
    type: challenge
    title: Pick the right answer
    xp: 20
    builder: { mode: choice, options: [RAG, Fine-tuning, Prompt caching] }  # choice | code
    grader:
      type: choice                  # choice | code
      answer: RAG
```

Graders run server-side, so answers never reach the browser. The SQL and data-check
graders (`sql_scalar`, `sql_result`, `check_failing_count`) were retired with the
practice database; a lab still using them loads but reports that it cannot be graded.

## Contributing a stack (local-tool recipe)

A stack is a YAML file in [`backend/stacks/`](backend/stacks) — prose + copyable code
blocks + use cases. Same PR-based contribution model as labs.

```yaml
id: my-tool
name: My Tool
category: Streaming      # groups it in the catalog
emoji: 🚀
difficulty: advanced     # intermediate | advanced | expert
summary: One-line pitch.
tags: [my-tool]
prerequisites: [Docker]
blocks:
  - type: md
    body: "## What you get\nMarkdown explanation."
  - type: code
    language: yaml
    filename: docker-compose.yml
    body: |
      services: { ... }
use_cases:
  - title: A real scenario
    body: Why a team reaches for this.
```

## Project website (GitHub Pages)

An interactive landing/docs page lives in [`docs/`](docs/index.html). To publish it:

1. Find-and-replace `https://github.com/your-org/dq-ai-labs` in `docs/index.html` with your repo URL.
2. Push, then in the repo: **Settings → Pages → Build and deployment → Deploy from a branch →
   branch `main`, folder `/docs`**.
3. Your site goes live at `https://<user>.github.io/<repo>/`.

It's a single self-contained `index.html` (teal theme, no build step) — open it locally to preview.

## Roadmap

- [x] Core DQ engine — connectors, profiling, check catalog, runs (Studio)
- [x] AI — auto-suggest checks, explain failures, tutor chat, quiz gen, code review, recommendations
- [x] Labs platform — file-based + in-app authoring, playground, code labs, grading
- [x] Gamification — XP/levels, streaks, badges, weekly quests, skill tree, leaderboard
- [x] Formations — instructor-led trainings with live GenAI practice & AI-graded challenges
- [x] Teams & roles — Skill Lead / manager dashboards, live-session schedule
- [ ] Reporting & exports — team/formation progress as CSV/PDF for HR reviews
- [ ] Notifications — email/Teams reminders for invites, upcoming sessions, streak nudges
- [ ] Certificates on formation completion; training-hours tracking per learner
- [ ] Skills matrix — map formations/labs to competencies, gap view per team
- [ ] Session attendance tracking (RSVP + check-in) to close the loop with the schedule
- [ ] Scheduled DQ runs (Celery), trend charts, alerting; more connectors (Snowflake/BigQuery)
