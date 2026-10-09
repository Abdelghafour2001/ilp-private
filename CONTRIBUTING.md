# Contributing to UpSkill

Thanks for wanting to add to the academy! 🎓

The best part of UpSkill is that **content is just files** — you don't need to touch
any application code to add a lab or a tool recipe. This guide walks you through
it from zero.

- [Run UpSkill locally](#1-run-aida-locally)
- [Tutorial: contribute your first lab](#2-tutorial-contribute-your-first-lab)
- [Lab schema reference](#3-lab-schema-reference)
- [The sandbox data](#4-the-sandbox-data)
- [Contribute a stack (tool recipe)](#5-contribute-a-stack-tool-recipe)
- [Author in the app instead (no Git)](#6-author-in-the-app-instead-no-git)
- [Submitting your PR](#7-submitting-your-pr)

---

## 1. Run UpSkill locally

You only need Docker.

```bash
git clone <repo-url> && cd DQ-AI
cp .env.example .env        # set CREDENTIALS_ENCRYPTION_KEY (and an LLM if you want the tutor)
docker compose up
```

Open http://localhost:3000. New content shows up after a restart, or instantly
via **Admin → Manage labs → Reload files**.

---

## 2. Tutorial: contribute your first lab

We'll build a small lab end-to-end: *"Find orders with an invalid status."*

### Step 1 — explore the data first

Open the **Playground** (http://localhost:3000/playground) and poke at the
`orders` table:

```sql
SELECT status, count(*) FROM orders GROUP BY status;
```

You'll see `paid`, `pending`, and one `unknown`. So a check that only allows
`paid`/`pending` should catch **1** bad row. That `1` is the answer your grader
will expect. **Always derive expected values from the real sandbox data this way.**

### Step 2 — create the file

Add `backend/labs/09-order-status.yaml`. The filename's number just controls
catalog ordering; the `id` inside is what matters.

```yaml
id: order-status
title: Valid Order Status
track: Operations
difficulty: beginner
summary: Catch orders stuck in an unexpected status.
tags: [validity, status]
dataset:
  schema: public
  table: orders

steps:
  - id: concept
    type: concept
    title: Why status matters
    body_md: |
      Downstream jobs branch on `status`. A value nobody expects — like
      `unknown` — silently breaks revenue reports and fulfilment.

  - id: build-check
    type: exercise
    title: Constrain the status column
    xp: 25
    body_md: |
      Build an **accepted_values** check on `status` allowing only
      `paid` and `pending`. It should catch the one rogue row.
    builder:
      mode: check
      table: orders
      hint_column: status
    grader:
      type: check_failing_count
      require_kind: accepted_values
      require_column: status
      expect: 1

  - id: count-bad
    type: challenge
    title: How many bad statuses?
    xp: 30
    body_md: |
      Write SQL returning the count of orders whose status is **not**
      `paid` or `pending`.
    builder:
      mode: sql
    grader:
      type: sql_scalar
      expect: 1
```

### Step 3 — test it

Restart (`docker compose restart backend`) or click **Admin → Reload files**.
Open your lab under **Labs**, work through the steps, and confirm both gradable
steps pass with the intended answer (and fail with a wrong one).

That's it — you've authored a lab. 🎉

---

## 3. Lab schema reference

### Top level

| Field | Required | Notes |
|---|---|---|
| `id` | ✅ | Unique slug (kebab-case). |
| `title` | ✅ | Shown in the catalog. |
| `track` | | Groups labs in the catalog (e.g. `Fundamentals`, `AI Engineering`). |
| `difficulty` | | `beginner` \| `intermediate` \| `advanced`. |
| `summary` | | One-line pitch. |
| `tags` | | List of strings. |
| `dataset` | ✅ | `{ schema, table }` — the default table for the lab's steps. |
| `steps` | ✅ | Ordered list of steps. |

### A step

| Field | Required | Notes |
|---|---|---|
| `id` | ✅ | Unique within the lab. |
| `type` | ✅ | `concept` (teaching only) \| `exercise` \| `challenge`. |
| `title` | ✅ | |
| `body_md` | | Markdown: `**bold**`, `` `code` ``, `> callouts`, `- lists`, `#` headings. |
| `xp` | | Points awarded on pass (default 0). |
| `builder` | | How the learner answers (below). Omit for `concept`. |
| `grader` | | How it's graded (below). Omit for `concept`. |

### Builder + grader (gradable steps)

Pick one **builder `mode`** and the matching **grader `type`**:

| `builder.mode` | Learner does | `grader.type` | Grader fields |
|---|---|---|---|
| `check` | builds a check in the UI | `check_failing_count` | `expect` / `expect_min` / `expect_max`; optional `require_kind`, `require_column` |
| `sql` | writes read-only SQL | `sql_scalar` | `expect` / `expect_min` / `expect_max` (compares the single returned value) |
| `choice` | picks an option | `choice` | `answer` (options listed under `builder.options`) |

**Builder fields:** `table` (defaults to the lab's dataset table), `schema`,
`hint_column` (pre-selects a column for `check` mode), `options` (list, for
`choice` mode).

**Grader fields:**
- `expect` — exact match. `expect_min` / `expect_max` — a range instead.
- `require_kind` — force a specific check kind (`not_null`, `unique`, `range`, `regex`, `accepted_values`, `row_count`, `freshness`, `custom_sql`).
- `require_column` — force the targeted column.
- `answer` — the correct option (for `choice`; case-insensitive).

> Graders run **server-side** against a **read-only** sandbox, so answers never
> reach the browser and learner SQL can't modify data.

---

## 4. The sandbox data

Labs grade against a small, intentionally-messy demo database. Two tables:

**`customers`** (7 rows) — `id, email, full_name, country, age, signup_date, created_at`
- 1 NULL email, 1 duplicate email, 1 malformed email
- 1 impossible `age` (220), 1 NULL `full_name`
- countries: US ×4, UK, FR, DE

**`orders`** (5 rows) — `id, customer_id, amount, status, created_at`
- 1 negative `amount` (−5.00)
- 1 orphan `customer_id` (99, no matching customer)
- statuses: paid ×3, pending, unknown

Use the **Playground** to compute exact expected values before setting `expect`.

---

## 5. Contribute a stack (tool recipe)

A **stack** is a copy-paste local setup for a real tool, in
[`backend/stacks/`](backend/stacks). Same idea — prose + code blocks + use cases.

```yaml
id: my-tool
name: My Tool
category: Streaming        # groups it in the Stacks catalog (e.g. "AI / ML")
emoji: 🚀
difficulty: intermediate   # intermediate | advanced | expert
summary: One-line pitch.
tags: [my-tool]
prerequisites:
  - Docker
blocks:
  - type: md
    body: |
      ## What you get
      Markdown explanation.
  - type: code
    language: yaml
    filename: docker-compose.yml      # optional label shown above the code
    body: |
      services:
        my-tool:
          image: my/tool
          ports: ["8080:8080"]
  - type: code
    language: bash
    body: |
      docker compose -f docker-compose.yml up -d
use_cases:
  - title: A real scenario
    body: Why a team reaches for this.
```

Each entry in `blocks` is either `type: md` (rendered as markdown) or
`type: code` (a copyable code block with an optional `language` / `filename`).

---

## 6. Author in the app instead (no Git)

Prefer a UI? **Admin → Manage labs → + New lab** gives you a visual editor:
fill in the lab details, add steps, choose a builder + grader per step, hit
**Validate**, then **Save**. It's stored in the database and goes live
immediately. You can also **fork & edit** any file-based lab from there.

(Admin endpoints can be protected with `ADMIN_TOKEN` — set it in `.env` and
enter it on the Admin page.)

---

## 7. Submitting your PR

A quick checklist before you open it:

- [ ] File is in `backend/labs/` (lab) or `backend/stacks/` (stack), `.yaml`.
- [ ] `id` is unique and kebab-case.
- [ ] Expected grader values were verified against the sandbox (Playground).
- [ ] You ran it locally and every gradable step passes with the right answer.
- [ ] Prose is clear and friendly — assume the reader is learning the topic.

Open the PR with a one-line description of what the lab/stack teaches. That's it —
the loader validates content on startup, so if it's malformed CI/boot will tell
you exactly what to fix. Thanks for contributing! 💚
