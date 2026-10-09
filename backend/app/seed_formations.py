"""Seed a real, complete formation — "Prompt Engineering for GenAI" — that
showcases every lesson type: theory articles, quizzes, live prompt playgrounds,
and LLM-judged prompt challenges. Also seeds a trainer and two trainees with
partial progress so the roster view looks alive.

Run after migrations:

    python -m app.seed_formations          # skips if the formation exists
    python -m app.seed_formations --force  # add anyway

In Docker:  docker compose exec backend python -m app.seed_formations
"""

from __future__ import annotations

import sys

from app.db.session import SessionLocal
from app.models import Formation, FormationEnrollment, FormationLessonCompletion, Learner

TITLE = "Prompt Engineering for GenAI"


def _learner(db, handle: str, role: str = "user", name: str | None = None) -> Learner:
    learner = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
    if not learner:
        learner = Learner(handle=handle, name=name)
        db.add(learner)
        db.flush()
    if role != "user":
        learner.role = role
    return learner


# --------------------------------------------------------------------------- #
# The curriculum: real training content                                        #
# --------------------------------------------------------------------------- #

M1_L1 = """
LLMs don't read — they **predict the next token**. Every word you type is split into
tokens (~4 characters each), fed through the model, and the reply is generated one
token at a time, each choice weighted by everything that came before it.

Three consequences that explain 90% of prompt behaviour:

- **The prompt is the program.** There is no hidden intent-reader: the only thing steering those token probabilities is the text you provide. Vague text in, average-of-the-internet text out.
- **Context is finite.** The model sees a fixed window (the *context window*). What isn't in it doesn't exist — and things buried in the middle of a huge prompt get less attention than the start and end.
- **Sampling adds randomness.** *Temperature* controls how adventurous the next-token choice is. Low (0–0.3) → focused and repeatable, good for extraction. High (0.8+) → creative and varied, good for brainstorming.

> A prompt is not a question you ask a person. It is a **configuration** you write for a very fast, very literal, very well-read intern with no memory of yesterday.

## Why "prompt engineering" is a real skill

The same model, on the same task, can move from unusable to production-grade purely
through the prompt. You'll prove that to yourself in the next lessons — same input
data, different prompts, radically different output quality.
""".strip()

M1_L2 = """
Strong prompts aren't magic incantations — they're just **well-structured briefs**.
Almost every production prompt is assembled from six blocks:

- **Role** — who the model should be: `You are a senior HR analyst…`
- **Task** — one unambiguous instruction: `Extract every skill mentioned…`
- **Context** — background the model can't guess: audience, product, constraints.
- **Input** — the data to work on, clearly delimited.
- **Output format** — exactly what the answer must look like: fields, length, tone, language.
- **Examples** — one or two input→output pairs when the format is subtle (*few-shot*).

## Delimiters: fence your data

Never let instructions and data blur together. Fence the input with markers the model
can't mistake:

```
Summarize the meeting notes between <notes> tags in 3 bullets.

<notes>
{PASTE NOTES HERE}
</notes>
```

This also protects you when the input itself contains something that *looks* like an
instruction — the model knows everything inside the fence is data, not commands.

> Rule of thumb: if a competent temp worker couldn't do the task from your brief alone,
> the model can't either. Write the brief.
""".strip()

M1_QUIZ = [
    {
        "question": "Why does putting critical instructions at the very start or end of a long prompt help?",
        "options": [
            "The model reads faster at the start",
            "Attention over a long context is strongest near its beginning and end",
            "Tokens at the end cost less",
            "It doesn't — position never matters",
        ],
        "answer_index": 1,
        "explanation": "Models attend less reliably to the middle of long contexts — the 'lost in the middle' effect.",
    },
    {
        "question": "You're extracting invoice fields into JSON for an automated pipeline. Which temperature is the best default?",
        "options": ["1.0 — maximum quality", "0.7 — balanced", "0 to 0.2 — focused and repeatable", "Temperature doesn't apply to extraction"],
        "answer_index": 2,
        "explanation": "Deterministic, structured tasks want low temperature; creativity wants higher.",
    },
    {
        "question": "What is the main job of delimiters like <notes>…</notes> in a prompt?",
        "options": [
            "They make the prompt shorter",
            "They separate instructions from data so data can't be read as commands",
            "They are required XML syntax for LLMs",
            "They increase the context window",
        ],
        "answer_index": 1,
        "explanation": "Fencing input keeps the model from treating the data — or anything malicious inside it — as instructions.",
    },
]

M2_L1 = """
The #1 failure mode in real teams is the **vague ask**. "Summarize this" produces a
summary for *nobody in particular*. Specific prompts name the audience, the length,
the format, and what to prioritise.

## The upgrade pattern

Take every vague verb and pin it down:

- "Summarize" → *for whom? how long? highlighting what?*
- "Improve this text" → *improve for clarity? persuasion? grammar? which tone?*
- "Analyze the data" → *which question should the analysis answer?*

Compare:

```
Bad:  Summarize these meeting notes.

Good: You are a chief of staff. Summarize the meeting notes in <notes> for
      an executive who missed the meeting. Output exactly 3 bullets:
      each bullet = decision or action, owner in bold, deadline if mentioned.
      Ignore small talk and scheduling chatter.
```

## Role prompting

Giving the model a **role** ("you are a security auditor") does two things: it selects
the vocabulary and priorities of that persona, and it implicitly sets the quality bar
("senior" beats "helpful assistant"). Use roles that match the task — an imaginary
title is free and often worth several points of quality.

Now open the playground on the left and try it on real meeting notes. →
""".strip()

M2_PG1_INPUT = """MEETING NOTES — Q3 platform sync, 14 July, 32 min
Present: Sara (PM), Yassine (backend), Leila (data), Omar (infra), Khadija (design)
Sara: welcome back everyone, hope the summer is going well. Quick reminder to fill the HR survey.
Yassine: the ingestion job failed twice last week, root cause is the schema drift on the CRM export. I can add a schema check but I need the new contract from the vendor first. Sara will chase the vendor — target Friday.
Leila: dashboards for the sales team are 80% done, blocked on the ingestion fix. Realistically ship the Tuesday after the vendor contract lands.
Omar: cluster migration to the new region is approved. Downtime window agreed: Saturday 02:00-04:00. Omar owns the runbook, review next sync.
Khadija: new onboarding screens tested well, 8/10 users completed without help. Wants dev capacity in August.
Sara: noted, we'll decide August staffing next week. Also: the exec review moved to the 28th, deck owners please update slides by the 25th.
"""

M2_PG1_GOAL = """
Turn the raw meeting notes (already loaded as the INPUT below your prompt) into an
**executive summary: exactly 3 bullets — each with a decision/action, an owner in
bold, and a deadline if one was mentioned**.

Try it in stages and watch the output change:

- Attempt 1: just write `Summarize the meeting notes.` — note how generic it is.
- Attempt 2: add a role, the audience, and the exact output format.
- Attempt 3: add exclusions ("ignore small talk, HR reminders, pleasantries").
""".strip()

M2_L2 = """
Sometimes the format you want is easier to **show** than to describe. That's
*few-shot prompting*: give 1–3 worked examples, then the real input. The model
continues the pattern.

```
Classify each support ticket. Reply with exactly: CATEGORY | URGENCY

Ticket: "I was charged twice this month, refund now or I cancel."
Answer: billing | high

Ticket: "Would love a dark mode in the mobile app someday!"
Answer: feature_request | low

Ticket: "{NEW TICKET}"
Answer:
```

## When few-shot beats instructions

- **Subtle formats** — easier to show `billing | high` than to define it.
- **Edge-case policy** — include an example of a weird input handled the way you want.
- **Tone matching** — a sample reply teaches voice better than adjectives.

Two traps: examples eat context (keep them short), and the model copies **everything**
about them — including mistakes and formatting inconsistencies. Curate your examples
like production code.

Practice it in the playground: build a few-shot classifier for support tickets. →
""".strip()

M2_PG2_INPUT = """1. "The export button has been greyed out since this morning, we have a board meeting at 3pm and need that report."
2. "hi! quick one — any plans to integrate with Slack?"
3. "Your last invoice charged us for 25 seats, we only have 19. Please fix."
4. "App crashes every time I open a project with more than 100 tasks. Happens on two devices."
5. "How do I change my notification settings?"
"""

M2_PG2_GOAL = """
The INPUT contains 5 raw support tickets. Write a **few-shot prompt** that classifies
every ticket as `CATEGORY | URGENCY | one-line reason`, where CATEGORY is one of
`bug, billing, feature_request, how_to` and URGENCY is `low, medium, high`.

- Include 2–3 worked examples of your own invented tickets *inside your prompt*.
- Then instruct the model to classify all 5 input tickets the same way.
- Check: did ticket 1 come out `high`? Did ticket 5 stay `low`? If not, sharpen your examples.
""".strip()

M2_QUIZ = [
    {
        "question": "Your few-shot classifier keeps answering in full sentences instead of `CATEGORY | URGENCY`. Most likely fix?",
        "options": [
            "Raise the temperature",
            "Make the examples' answers match the exact target format, character for character",
            "Add more polite wording",
            "Use a bigger model — format can't be controlled",
        ],
        "answer_index": 1,
        "explanation": "The model imitates the examples. If examples are clean and consistent, the output follows.",
    },
    {
        "question": "Which task benefits MOST from adding a role/persona to the prompt?",
        "options": [
            "Adding 2+2",
            "Reviewing a contract clause for legal risk",
            "Repeating a string verbatim",
            "Converting Celsius to Fahrenheit",
        ],
        "answer_index": 1,
        "explanation": "Roles pay off when domain judgment, vocabulary, and priorities matter.",
    },
]

M3_L1 = """
Two techniques turn an LLM from a text generator into a **reliable component**.

## 1. Give it room to reason

For anything with logic — math, planning, tricky classification — ask the model to
**work step by step before answering**. Quality jumps because each reasoning token
becomes context for the next.

```
First, list the constraints you can find in the request.
Then check each candidate slot against every constraint.
Only after that, output the final answer line: ANSWER: <slot>
```

The trick is *separating thinking from the answer*, so downstream code can still parse
the final line. (Reasoning models do much of this internally — but explicit structure
still helps on hard problems.)

## 2. Constrain the output — JSON contracts

Pipelines don't read prose. When another program consumes the output, specify a
**contract**:

```
Reply with ONLY valid JSON, no markdown, matching exactly:
{
  "title": string,
  "seniority": "junior" | "mid" | "senior" | null,
  "skills": string[],        // lowercase, deduplicated
  "salary_range": string | null   // null if not stated
}
Use null when a field is not present in the input. Do not invent values.
```

Note the three defenses: **only JSON** (no chatty preamble), an **explicit schema**
(types + allowed values), and a **null policy** (the #1 source of hallucinated
fields is not telling the model what to do when data is missing).

Your first graded challenge applies exactly this. →
""".strip()

M3_CH_INPUT = """We're hiring!!! 🚀
Rockstar Data Wizard wanted at DataMint (Casablanca office or remote in Morocco)
About us: DataMint helps retailers see their data clearly. 40 people, Series A.
You will: build and babysit our ELT pipelines (Airflow, dbt, BigQuery), own data quality end to end, and pair with analysts.
You have: 4+ years with Python & SQL, you've run dbt in production, bonus points for Terraform and a sense of humor.
We offer: competitive salary (14-18k MAD/month), health insurance, annual learning budget.
Send your CV to jobs@datamint.ma before end of month.
"""

M3_CH_TASK = (
    "Write ONE prompt that extracts structured data from the raw job posting given as INPUT. "
    "The model's reply must be ONLY valid JSON with exactly these fields: "
    'company (string), title (string), location (string), remote (boolean), '
    'seniority ("junior"|"mid"|"senior"|null), skills (array of lowercase strings), '
    "salary_range (string or null), apply_deadline (string or null). "
    "Missing information must become null — never invented."
)

M3_CH_RUBRIC = [
    "The prompt demands ONLY JSON output (no prose, no markdown fences).",
    "The prompt spells out the exact schema: every field name with its type / allowed values.",
    "The prompt states a null policy for missing data and forbids inventing values.",
    "The prompt clearly delimits the job posting as input data (e.g. tags or fences).",
    "The produced output is valid JSON with sensible values for this posting (e.g. remote=true, skills include python/sql/dbt).",
]

M3_QUIZ = [
    {
        "question": "Your extraction prompt returns JSON wrapped in ```json fences, which breaks the parser. Best fix?",
        "options": [
            "Parse the fences away forever",
            "Explicitly instruct: reply with ONLY raw JSON — no markdown, no commentary",
            "Lower the temperature to 0",
            "Shorten the input",
        ],
        "answer_index": 1,
        "explanation": "Models add fences out of habit; saying 'raw JSON only, no markdown' removes them at the source (belt-and-suspenders parsing is still wise).",
    },
    {
        "question": "Why ask the model to reason step by step BEFORE the final answer, instead of just answering?",
        "options": [
            "It uses fewer tokens",
            "Each reasoning token becomes context that conditions the final answer",
            "It disables hallucinations completely",
            "It's required for JSON output",
        ],
        "answer_index": 1,
        "explanation": "Generated reasoning is fed back as context for the next tokens — the model literally thinks in writing.",
    },
]

M4_L1 = """
Everything so far was a single prompt in a chat. In production, prompts live in
**systems**: they run thousands of times, on inputs you didn't write, and other code
depends on their output. That changes the craft.

## The production checklist

- **System prompt = constitution.** Role, rules, tone, and refusal policy live in the system prompt; the user turn carries only the task + data.
- **Enumerate, don't imply.** If there are 4 valid categories, list all 4 and say "never output anything else". Open sets invite drift.
- **Design the edge cases.** What should happen with an empty input? A different language? Something ambiguous? If you don't decide, the model decides differently every time. A `needs_human` escape hatch beats a confident wrong answer.
- **One example beats three adjectives.** Show a perfect output inside the prompt.
- **Evaluate like code.** Keep a small set of tricky test inputs and re-run them after every prompt change — that's the judge's job in this course, and yours at work.

> The capstone below is graded against exactly this checklist. Treat it like a prompt
> you'd ship: role, enumerated labels, JSON contract, edge-case policy, one worked example.
""".strip()

M4_CH_INPUT = """EMAIL 1
From: fatima.z@retailplus.ma
Subject: URGENT - account locked before campaign launch
We launch our Eid campaign TOMORROW morning and my whole team is locked out since the 2FA change. Nobody can access the dashboard. Call me back immediately, this is costing us money.

EMAIL 2
From: youssef@selfemployed.ma
Subject: question
hey. does the pro plan include the API or is that extra? also is there a student discount? thanks

EMAIL 3
From: karim.b@logimaroc.com
Subject: Re: Re: Re: invoice dispute
As I told your colleague twice already, invoice #4482 bills the annual plan although we downgraded to monthly in March. I am beyond frustrated. If this is not resolved this week we are moving to your competitor and I will say why on LinkedIn.
"""

M4_CH_TASK = (
    "Design ONE production-grade triage prompt for a customer-support inbox. Given the three raw "
    "emails as INPUT, the model must return ONLY a JSON array with one object per email: "
    '{"id": number, "category": "access_issue"|"billing"|"pre_sales"|"bug"|"other", '
    '"urgency": "low"|"medium"|"high", "sentiment": "calm"|"frustrated"|"angry", '
    '"churn_risk": boolean, "reply_opening": string (one empathetic sentence in the customer\'s language), '
    '"route_to": "support"|"billing"|"sales"|"needs_human"}. '
    "The prompt must define the assistant's role, enumerate every allowed value, include at least "
    "one worked example, and state what to do with ambiguous or out-of-scope emails."
)

M4_CH_RUBRIC = [
    "Defines a clear role/persona for the triage assistant in a system-prompt style.",
    "Enumerates ALL allowed values for category, urgency, sentiment and route_to, and forbids values outside the lists.",
    "Specifies the exact JSON output contract (array of objects, field names, only-JSON policy).",
    "Includes at least one worked input→output example inside the prompt (few-shot).",
    "Handles edge cases explicitly: ambiguity or out-of-scope input routes to needs_human rather than guessing.",
    "The produced output correctly reflects the 3 emails (e.g. email 1 high urgency access_issue, email 3 angry billing with churn_risk true).",
]

M4_L2 = """
## You shipped a production prompt 🎉

You now own the full toolkit: specific asks, roles, delimiters, few-shot examples,
step-by-step reasoning, JSON contracts, and edge-case policies — and you've had your
prompts graded the way production prompts are evaluated: against a rubric, on real input.

## Where to go deeper

- **Anthropic prompt engineering guide** — docs.anthropic.com, the canonical reference for Claude.
- **OpenAI cookbook / prompting guide** — same ideas, different flavour.
- **"Lost in the Middle" (Liu et al., 2023)** — why context position matters.
- Build something! The Playground and the AI labs on this platform are open 24/7.

> Ideas to practice on: a CV screener with a JSON contract, a meeting-minutes bot for
> your team, a data-quality rule explainer for Studio failures.
""".strip()


def build_curriculum() -> dict:
    return {
        "modules": [
            {
                "title": "How LLMs actually work",
                "lessons": [
                    {
                        "id": "m1-tokens",
                        "title": "Tokens, context & temperature — the mental model",
                        "type": "article",
                        "body_md": M1_L1,
                        "xp": 10,
                        "duration_min": 8,
                    },
                    {
                        "id": "m1-anatomy",
                        "title": "Anatomy of a prompt: the six blocks",
                        "type": "article",
                        "body_md": M1_L2,
                        "xp": 10,
                        "duration_min": 8,
                    },
                    {
                        "id": "m1-quiz",
                        "title": "Checkpoint: the mental model",
                        "type": "quiz",
                        "questions": M1_QUIZ,
                        "xp": 15,
                        "duration_min": 5,
                    },
                ],
            },
            {
                "title": "Core techniques: specificity, roles & few-shot",
                "lessons": [
                    {
                        "id": "m2-specific",
                        "title": "From vague ask to sharp brief",
                        "type": "article",
                        "body_md": M2_L1,
                        "xp": 10,
                        "duration_min": 7,
                    },
                    {
                        "id": "m2-play-summary",
                        "title": "Playground: fix the vague summary prompt",
                        "type": "prompt_playground",
                        "body_md": "Same input, different prompts — watch the quality move. The meeting notes are already wired in as INPUT; you only write the prompt.",
                        "goal_md": M2_PG1_GOAL,
                        "challenge_input": M2_PG1_INPUT,
                        "starter_prompt": "Summarize the meeting notes.",
                        "xp": 20,
                        "duration_min": 10,
                    },
                    {
                        "id": "m2-fewshot",
                        "title": "Few-shot prompting: show, don't tell",
                        "type": "article",
                        "body_md": M2_L2,
                        "xp": 10,
                        "duration_min": 7,
                    },
                    {
                        "id": "m2-play-fewshot",
                        "title": "Playground: build a few-shot ticket classifier",
                        "type": "prompt_playground",
                        "body_md": "Five raw support tickets are loaded as INPUT. Craft a few-shot prompt that classifies all of them consistently.",
                        "goal_md": M2_PG2_GOAL,
                        "challenge_input": M2_PG2_INPUT,
                        "starter_prompt": "",
                        "xp": 20,
                        "duration_min": 12,
                    },
                    {
                        "id": "m2-quiz",
                        "title": "Checkpoint: core techniques",
                        "type": "quiz",
                        "questions": M2_QUIZ,
                        "xp": 15,
                        "duration_min": 4,
                    },
                ],
            },
            {
                "title": "Reasoning & structured output",
                "lessons": [
                    {
                        "id": "m3-structure",
                        "title": "Step-by-step reasoning & JSON contracts",
                        "type": "article",
                        "body_md": M3_L1,
                        "xp": 10,
                        "duration_min": 9,
                    },
                    {
                        "id": "m3-challenge",
                        "title": "Graded challenge: extract a job posting to JSON",
                        "type": "prompt_challenge",
                        "body_md": "Your first graded prompt. An AI examiner scores your PROMPT against the rubric — the model's output is the evidence. Pass mark: 70/100.",
                        "task": M3_CH_TASK,
                        "challenge_input": M3_CH_INPUT,
                        "rubric": M3_CH_RUBRIC,
                        "min_score": 70,
                        "xp": 40,
                        "duration_min": 15,
                    },
                    {
                        "id": "m3-quiz",
                        "title": "Checkpoint: structured output",
                        "type": "quiz",
                        "questions": M3_QUIZ,
                        "xp": 15,
                        "duration_min": 4,
                    },
                ],
            },
            {
                "title": "Capstone: production-grade prompts",
                "lessons": [
                    {
                        "id": "m4-production",
                        "title": "System prompts, guardrails & evaluation",
                        "type": "article",
                        "body_md": M4_L1,
                        "xp": 10,
                        "duration_min": 8,
                    },
                    {
                        "id": "m4-capstone",
                        "title": "Capstone: customer-support triage prompt",
                        "type": "prompt_challenge",
                        "body_md": "The final boss. Three raw customer emails, one prompt, a strict rubric. Pass mark: 75/100 — iterate until it holds.",
                        "task": M4_CH_TASK,
                        "challenge_input": M4_CH_INPUT,
                        "rubric": M4_CH_RUBRIC,
                        "min_score": 75,
                        "xp": 60,
                        "duration_min": 20,
                    },
                    {
                        "id": "m4-wrap",
                        "title": "Wrap-up & where to go deeper",
                        "type": "article",
                        "body_md": M4_L2,
                        "xp": 10,
                        "duration_min": 4,
                    },
                ],
            },
        ]
    }


def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        exists = db.query(Formation).filter(Formation.title == TITLE).first()
        if exists and not force:
            print(f"'{TITLE}' already seeded (id={exists.id}) — use --force to add another.")
            return

        trainer = _learner(db, "amina", role="trainer", name="Amina El Fassi")
        t1 = _learner(db, "mehdi")
        t2 = _learner(db, "sofia")

        formation = Formation(
            title=TITLE,
            summary=(
                "Hands-on formation: learn to write prompts that hold up in production — "
                "roles, few-shot, reasoning, JSON contracts — with live playgrounds and "
                "AI-graded prompt challenges."
            ),
            level="intermediate",
            emoji="🪄",
            tags=["genai", "prompting", "llm", "ai-engineering"],
            objectives=[
                "Explain how tokens, context windows and temperature shape LLM behaviour",
                "Turn vague asks into precise, role-driven prompts",
                "Use few-shot examples to lock output format and tone",
                "Design step-by-step reasoning and strict JSON output contracts",
                "Ship a production-grade triage prompt with guardrails and edge-case policy",
            ],
            curriculum=build_curriculum(),
            trainer_id=trainer.id,
            trainer_name=trainer.name or trainer.handle,
            status="published",
            open_enrollment=False,
        )
        db.add(formation)
        db.flush()

        # mehdi is mid-way through module 2; sofia was just invited.
        db.add(FormationEnrollment(formation_id=formation.id, learner_id=t1.id, status="active", invited_by=formation.trainer_name))
        db.add(FormationEnrollment(formation_id=formation.id, learner_id=t2.id, status="invited", invited_by=formation.trainer_name))
        for lesson_id, data in [
            ("m1-tokens", {}),
            ("m1-anatomy", {}),
            ("m1-quiz", {}),
            ("m2-specific", {}),
            ("m2-play-summary", {"runs": 3}),
        ]:
            db.add(
                FormationLessonCompletion(
                    learner_id=t1.id, formation_id=formation.id, lesson_id=lesson_id, data=data
                )
            )
        t1.xp += 65

        db.commit()
        print(f"Seeded formation '{TITLE}' (id={formation.id})")
        print(f"  trainer: {trainer.handle} (role={trainer.role})")
        print(f"  trainees: {t1.handle} (active, 5 lessons done), {t2.handle} (invited)")
        print(f"  join code: {formation.join_code}")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
