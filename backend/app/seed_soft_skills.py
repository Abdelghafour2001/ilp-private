"""Seed three complete NON-technical formations — soft skills, project
management, UX — so demos show the platform covers all of L&D, not just IT.

Run inside the backend container:
    python -m app.seed_soft_skills [--force]

Creates trainer Fatima Benjelloun, the 3 published formations with full
curricula (articles + graded quizzes), varied enrollments across the demo
teams, and upcoming live sessions on the shared schedule.
"""

import datetime as dt
import sys

from app.db.session import SessionLocal
from app.models import (
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    FormationSession,
    Learner,
)
from app.schemas.formation import lesson_ids

TODAY = dt.date.today()
LOCAL_UTC_OFFSET = dt.timedelta(hours=1)  # Morocco local time in July

TRAINER = ("fatima.benjelloun", "Fatima Benjelloun")


def _quiz(question: str, options: list[str], answer: int, explanation: str = "") -> dict:
    return {"question": question, "options": options, "answer_index": answer, "explanation": explanation}


def A(id, title, body, xp=10, mins=7):  # article
    return {"id": id, "title": title, "type": "article", "body_md": body, "xp": xp, "duration_min": mins}


def Q(id, title, questions, xp=15, mins=5):  # quiz
    return {"id": id, "title": title, "type": "quiz", "questions": questions, "xp": xp, "duration_min": mins}


# --------------------------------------------------------------------------- #
# 1. Effective Communication & Feedback                                       #
# --------------------------------------------------------------------------- #

COMMS = {
    "title": "Effective Communication & Feedback",
    "summary": "Say what you mean, land it well, and give feedback people can actually use — the SBI model, active listening, and difficult conversations.",
    "level": "beginner",
    "emoji": "🗣️",
    "format": "in_person",
    "prerequisites": (
        "Aucun prérequis. Venez avec une situation réelle (un feedback à donner, une conversation "
        "difficile à préparer) : les ateliers s'appuient sur vos cas."
    ),
    "tags": ["soft-skills", "communication", "feedback", "management"],
    "objectives": [
        "Diagnose why a message failed and fix it (audience, intent, medium)",
        "Give concrete, non-judgmental feedback with the SBI model",
        "Receive criticism without defensiveness and turn it into actions",
        "Prepare and lead a difficult conversation with a clear outcome",
        "Run meetings with an agenda, a decision, and an owner for every action",
    ],
    "curriculum": {"modules": [
        {"title": "Foundations of clear communication", "lessons": [
            A("cm-why", "Why messages break down", """Most workplace conflict is not disagreement — it's **misunderstanding**. A message travels through four gates and can die at any of them:

1. **What I meant** — my intent, clear in my head.
2. **What I said** — often compressed, jargon-filled, or hedged.
3. **What they heard** — filtered by context, stress, and language.
4. **What they understood** — reconstructed with *their* assumptions.

> The single biggest improvement you can make: **check gate 4**. End important exchanges with "What will you take away from this?" — not "OK?"

**Common failure patterns**
- *The curse of knowledge*: you forget what it's like not to know.
- *Hedging*: "maybe we could possibly consider…" hides the actual request.
- *Channel mismatch*: complex or emotional topics sent over chat.

In this formation you'll practice fixing all three."""),
            A("cm-triangle", "The message triangle: audience, intent, medium", """Before any important message, answer three questions:

**1. Audience — who exactly is this for?**
A steering committee wants risks and decisions. An engineer wants specifics. Writing "for everyone" means writing for no one — pick the primary reader.

**2. Intent — what should change after they read it?**
Every message is one of: *inform*, *request*, *decide*, or *align*. Name it in the first sentence: "I need a decision on X by Friday" beats three paragraphs of context.

**3. Medium — does the channel match the stakes?**
- Quick factual question → **chat**
- Decision with trade-offs → **short doc + meeting**
- Sensitive or personal feedback → **face to face** (or video)
- Announcement → **email**, then live Q&A

**The 30-second rule**: if your reader only gets 30 seconds, would they still catch the point? Put the conclusion first (BLUF — *bottom line up front*), then the reasoning."""),
            Q("cm-quiz1", "Check: getting the message across", [
                _quiz("A colleague keeps misunderstanding your requests on chat. The FIRST thing to try is:",
                      ["Write longer messages with more detail",
                       "State the intent up front and ask them to confirm their takeaway",
                       "CC their manager for visibility",
                       "Switch everything to email"], 1,
                      "Checking gate 4 (what they understood) fixes most breakdowns; more text usually makes it worse."),
                _quiz("You must announce a re-organization of the team. Best medium?",
                      ["A detailed chat message", "A meeting with Q&A, followed by a written summary",
                       "A PowerPoint sent by email", "One-on-ones only, over two weeks"], 1,
                      "High-stakes + emotional = live conversation with questions, then something written to refer back to."),
            ]),
        ]},
        {"title": "Giving & receiving feedback", "lessons": [
            A("cm-sbi", "The SBI model: Situation — Behavior — Impact", """Feedback fails when it sounds like a judgment of the *person*. The **SBI model** keeps it factual:

- **Situation** — anchor it in time and place: *"In yesterday's client demo…"*
- **Behavior** — describe what you observed, not your interpretation: *"…you answered the pricing question before Sara finished her point…"*
- **Impact** — say the effect it had: *"…she stopped contributing and we lost her analysis."*

Compare:
- ❌ "You're always interrupting people." (character attack, "always" invites debate)
- ✅ "In yesterday's demo, when you answered over Sara, she went quiet for the rest of the call."

**Three rules that make SBI work**
1. **Soon** — within days, not at the annual review.
2. **Small** — one behavior at a time; a list feels like an ambush.
3. **Ask** — finish with a question: "How did you see it?" Feedback is a conversation, not a verdict.

Positive feedback deserves SBI too — "great job" teaches nothing; *"your risk slide (S) with the three scenarios (B) is why the sponsor approved (I)"* gets repeated."""),
            A("cm-receive", "Receiving feedback without defensiveness", """Your instinct on hearing criticism is to **explain**. Explaining feels like defending, and it stops the flow of information you need.

**The 3-step receive**
1. **Listen fully** — don't rebut, don't interrupt. Take a note.
2. **Clarify with examples** — "Can you give me a recent example?" turns vague labels ("not proactive") into fixable behaviors.
3. **Thank + decide later** — "Thanks, let me think about this" is complete. You can disagree *after* you've understood.

**Separate the three judgments** (from *Thanks for the Feedback*):
- *Truth* — is it accurate?
- *Relationship* — am I discounting it because of who says it?
- *Identity* — is it threatening how I see myself?

Most rejected feedback is rejected for reasons 2 and 3, not 1.

**Close the loop**: when you change something because of feedback, tell the person. Nothing trains your environment to keep you informed like showing that input lands."""),
            Q("cm-quiz2", "Check: feedback in practice", [
                _quiz("Which is a correct SBI formulation?",
                      ["\"You need to be more of a team player.\"",
                       "\"In Monday's stand-up, when you dismissed the QA concern, the team stopped raising risks.\"",
                       "\"Everyone says you're hard to work with.\"",
                       "\"You always deliver late and it's a problem.\""], 1,
                      "Situation (Monday's stand-up) + observed behavior + concrete impact, no character judgment."),
                _quiz("Your manager calls your report \"superficial\". Best first response?",
                      ["Explain how much work went into it",
                       "Ask which section felt superficial and what a good one looks like",
                       "Promise to redo it entirely",
                       "Ask a colleague if they agree"], 1,
                      "Clarifying with examples converts a label into something you can act on."),
            ]),
        ]},
        {"title": "Difficult conversations & better meetings", "lessons": [
            A("cm-difficult", "Preparing a difficult conversation", """Difficult conversations go wrong when you improvise. Prepare four things on one page:

**1. The opening line — neutral and honest.**
*"I want to talk about the deadline we missed, and how we work together on estimates."* No ambush, no small talk that delays the point.

**2. The facts you're sure of.** Two or three, checkable. If you're not sure, it's a question, not a statement.

**3. Their likely story.** There is always one, and it's rarely "I don't care." Budget cut? Unclear brief? Personal issue? Planning for their perspective keeps you curious instead of accusatory.

**4. The outcome you want.** An agreement? A behavior change? A repaired relationship? If you can't name it, postpone the conversation.

**During**: speak your side in under 2 minutes, then ask *"How do you see it?"* — and actually listen. The magic ratio in a hard conversation is listening ~60% of the time.

**End with one sentence both of you would repeat**: what was agreed, who does what, when you check in again."""),
            A("cm-meetings", "Running meetings people don't hate", """A meeting is **the most expensive tool** in the building — six people × one hour is nearly a person-day. Spend it like money.

**Before**
- No agenda, no meeting. One line per topic, each phrased as a *question to answer*.
- Invite deciders and contributors; everyone else gets the notes.
- 25 or 50 minutes, not 30/60 — give people transitions.

**During**
- Open with the decision(s) needed, not with slides.
- Park side-topics visibly ("parking lot"), come back only if time allows.
- Silence ≠ agreement: ask the quietest expert directly.

**After — the part everyone skips**
Send within the hour, three sections only:
1. **Decisions made**
2. **Actions** — each with *one* owner and a date
3. **Open questions** — with who follows up

> If a recurring meeting produced no decisions and no actions twice in a row, cancel it and see who objects. That's your real attendance list."""),
            Q("cm-quiz3", "Final check", [
                _quiz("The best opener for a conversation about repeated missed deadlines:",
                      ["\"Do you have a minute? It's nothing serious.\"",
                       "\"I want to talk about the last two deadlines and how we plan work together.\"",
                       "\"HR asked me to talk to you.\"",
                       "\"Why do you keep missing deadlines?\""], 1,
                      "Names the topic honestly, without ambush ('nothing serious') or accusation ('why do you keep…')."),
                _quiz("Your weekly status meeting ends with no decisions or actions, again. You should:",
                      ["Make it longer to fit more discussion", "Add more attendees for better input",
                       "Replace it with a written status + cancel until a decision is needed", "Keep it — it builds team spirit"], 2,
                      "Meetings are for decisions; status can be written. Cancel and see what breaks."),
                _quiz("Action items in meeting notes must have:",
                      ["A responsible team", "One owner and a date", "A priority label", "Management approval"], 1,
                      "Shared ownership is no ownership; a date makes it checkable."),
            ]),
        ]},
    ]},
}

# --------------------------------------------------------------------------- #
# 2. Project Management Essentials                                            #
# --------------------------------------------------------------------------- #

PM = {
    "title": "Project Management Essentials",
    "summary": "Scope, plan, de-risk and deliver a project — WBS, estimation, risk registers, waterfall vs agile, and stakeholder management that keeps sponsors on your side.",
    "level": "intermediate",
    "emoji": "📋",
    "format": "hybrid",
    "prerequisites": (
        "Avoir participé à au moins un projet, même comme contributeur. Idéalement, avoir un projet "
        "en cours ou à venir sur lequel appliquer les outils."
    ),
    "tags": ["soft-skills", "project-management", "planning", "agile"],
    "objectives": [
        "Write a project charter a sponsor can approve in one reading",
        "Break scope into a work breakdown structure and a realistic plan",
        "Estimate with ranges and buffers instead of single wishful numbers",
        "Keep a living risk register with owners and triggers",
        "Choose waterfall, agile or hybrid based on the work — not fashion",
        "Map stakeholders and communicate to each at the right altitude",
    ],
    "curriculum": {"modules": [
        {"title": "Project foundations", "lessons": [
            A("pm-fail", "Why projects fail (and what the data says)", """Studies keep finding the same top causes of project failure — and none of them is "bad Gantt chart":

1. **Unclear scope** — nobody agreed what "done" means.
2. **Absent sponsor** — decisions wait weeks; the project drifts.
3. **Wishful estimates** — the plan assumed the best case for every task.
4. **Ignored risks** — everyone knew, nobody owned it.
5. **Silent stakeholders** — the objection arrives at go-live.

The pattern: projects fail at the **start**, they just die at the end. That's good news — the fixes are cheap and early:

- A one-page **charter**: objective, scope in/out, sponsor, success criteria, top risks.
- A named **sponsor** who commits to a decision SLA (e.g. 48h).
- **Range estimates** with an explicit buffer.
- A **risk register** reviewed in every steering meeting.

> Rule of thumb: if you cannot state the project's objective in one sentence that a non-expert understands, the project is not ready to start."""),
            A("pm-triangle", "Scope, time, cost — and the quality lever", """The **triple constraint**: scope, time and cost are connected — push one, the others move. Pretending otherwise doesn't change physics, it changes *quality*, silently.

When a sponsor asks for "same scope, sooner, same team", your job is to make the trade-off **explicit**:

- **Cut scope** — ship the core, phase the rest. Usually the right answer.
- **Add time** — move the date, keep the promise.
- **Add cost** — more people (careful: *Brooks' law* — adding people to a late project makes it later, onboarding eats the gain).

**How to say it** (this sentence de-escalates most negotiations):
> "We can have it earlier — which of these features moves to phase 2?"

**Quality is not a lever you may pull silently.** Skipped tests and design shortcuts are *scope cuts you hid from the sponsor* — they always come back with interest. If quality must flex, it's a decision the sponsor makes, in writing."""),
            Q("pm-quiz1", "Check: foundations", [
                _quiz("A sponsor wants the same scope two months earlier. Your best response:",
                      ["Commit and push the team harder", "Refuse — the plan is the plan",
                       "Present the trade-off: which scope moves to phase 2, or what budget is added",
                       "Accept and quietly cut testing"], 2,
                      "Make the triple constraint explicit; hidden quality cuts are the worst option."),
                _quiz("The most common root cause of project failure is:",
                      ["Wrong tooling", "Unclear scope and success criteria", "Team skills", "Too few meetings"], 1),
            ]),
        ]},
        {"title": "Planning the work", "lessons": [
            A("pm-wbs", "From objective to work breakdown structure", """A **WBS** turns a fuzzy objective into pieces you can estimate, assign and track.

**How to build one (workshop, 90 minutes, whole team)**
1. Write the objective at the top: *"HR portal live for all 3 sites"*.
2. Ask: "what are the 4-7 big **deliverables**?" (not activities — things you could point at: *Trained users*, *Migrated data*, *Signed-off security review*.)
3. Break each deliverable into **work packages** of 2-10 days of effort. Smaller than 2 days = micromanagement; bigger than 10 = hidden surprises.
4. For each package: one **owner**, a **definition of done**, and dependencies.

**The 100% rule**: the WBS contains *all* the work — including the unglamorous packages everyone forgets:
- training & documentation
- data migration and cleanup
- environment/access setup
- go-live support and hypercare

If it's not in the WBS, it will still happen — unplanned, in week 11, at 2am.

A WBS on a wall (or a Miro board) is also your best communication tool: sponsors see scope, the team sees ownership, and "scope creep" becomes visible the moment someone proposes a package that isn't there."""),
            A("pm-estimate", "Estimating: why we're always wrong, and how to be less wrong", """Humans estimate the *best case* — the version where nothing interrupts, nobody is sick, and the API documentation is accurate. Reality bats last.

**Techniques that actually help**
- **Range, not point**: "3-5 weeks" is honest; "4 weeks" is a lie with confidence.
- **Three-point**: estimate optimistic (O), most-likely (M), pessimistic (P); plan with **(O + 4M + P) / 6**.
- **Reference class**: "how long did the last three similar things take?" beats introspection every time.
- **Planning poker**: estimate independently, reveal together — kills anchoring, surfaces the person who knows the hidden dependency.

**Buffers are project-level, not per task.** Padding every task disappears into Parkinson's law ("work expands to fill the time"). Instead: honest task estimates + one visible buffer (15-25%) owned by the PM.

**Track your calibration**: after each project, compare estimated vs. actual. Most teams discover a consistent ×1.4-×1.6 factor — knowing yours turns estimating from guessing into engineering."""),
            A("pm-risk", "A risk register in 30 minutes", """A risk register is not paperwork — it's the list of things that will make you miss the date, written down *before* they do.

**Format — one row per risk, six fields, keep it under 15 rows:**
*risk · probability · impact · owner · trigger · response*

Example entries:
- **Key API not ready** — prob. high, impact high — owner Sarah — trigger: vendor misses the June milestone — response: mock the API + parallel manual process
- **Data quality worse than assumed** — prob. medium, impact high — owner Karim — trigger: >10% rejects in the first sample — response: add a 2-week cleanup package

**The 30-minute workshop**: everyone writes risks silently (5 min), cluster duplicates, score probability × impact, take the top 8-10. Each gets an **owner** (watches the trigger) and a **response** decided *now*, calmly — not in the panic of week 9.

**The four responses**: *avoid* (change the plan), *mitigate* (reduce probability/impact), *transfer* (contract, insurance), *accept* (document and move on). "Accept" is legitimate — silent acceptance is not.

Review the top risks in every steering meeting: 5 minutes, has anything triggered, any new ones. A register nobody re-reads is a museum piece."""),
            Q("pm-quiz2", "Check: planning", [
                _quiz("A good work package in a WBS is:",
                      ["An activity like 'coordinate with IT'", "2-10 days of effort with one owner and a definition of done",
                       "Anything under one day so tracking is precise", "A milestone date"], 1),
                _quiz("Where should schedule buffer live?",
                      ["Hidden inside each task estimate", "As one visible project-level buffer owned by the PM",
                       "In the sponsor's head", "Nowhere — buffers cause laziness"], 1,
                      "Per-task padding evaporates (Parkinson's law); a visible shared buffer can be managed."),
                _quiz("A risk with high probability and high impact that you can't avoid or reduce should be:",
                      ["Deleted from the register to keep it short", "Accepted explicitly, documented, with the sponsor informed",
                       "Kept secret to avoid alarming the sponsor", "Re-scored as low to keep morale up"], 1),
            ]),
        ]},
        {"title": "Delivery: waterfall, agile, hybrid", "lessons": [
            A("pm-methods", "Choosing waterfall, agile — or honestly hybrid", """The method follows the **nature of the work**, not the other way round.

**Waterfall fits when…**
- requirements are stable and knowable up front (regulatory, construction, migrations)
- rework is very expensive (you don't 'iterate' a data-center move)
- many fixed external dependencies need long-range coordination

**Agile fits when…**
- requirements will be *discovered*, not specified (new products, UX)
- you can ship value in slices and learn from real users
- the team is stable and empowered to decide

**Most corporate reality is hybrid** — and that's fine if it's *deliberate*: e.g. fixed milestones and budget gates (waterfall shell) with iterative build inside each phase (agile core). What kills projects is *cargo-cult agile*: stand-ups and sprints bolted onto a fixed-scope, fixed-date contract — ceremony without the empowerment.

**One-question test**: *"Can the scope genuinely change based on what we learn?"* If no — stop pretending, run a well-managed waterfall and everyone sleeps better."""),
            A("pm-kanban", "Kanban & stand-ups without the cargo cult", """**Kanban in one paragraph**: visualize the work (To do / Doing / Done — add columns only when they mean a real hand-off), **limit work in progress**, and watch where tickets pile up — that column is your bottleneck; fix *it* instead of starting more work.

**WIP limits are the whole point.** A team of 4 with 12 things "in progress" is context-switching, not working. Rule of thumb: WIP ≤ team size + 1. Finishing beats starting.

**Stand-ups that earn their 15 minutes**
- Walk the *board*, not the people: "what does ticket 42 need to move right?"
- Blockers get an owner and a follow-up *outside* the stand-up.
- Status recitals ("yesterday I… today I…") belong in the tool, not out loud.

**Metrics worth watching** (all free with a board):
- **Cycle time** — days from Doing → Done; the honest speed of the team.
- **Aging WIP** — anything in Doing > X days gets asked about.
- **Throughput** — items finished per week; use it to forecast instead of estimating everything twice.

If the board doesn't match reality ("it's done, I just didn't move it"), the board is dead — fix that first."""),
            Q("pm-quiz3", "Check: delivery", [
                _quiz("A fixed-scope, fixed-date regulatory migration is best run as:",
                      ["Scrum with 2-week sprints", "A well-planned waterfall with milestone gates",
                       "Kanban with no plan", "Whatever the team prefers"], 1,
                      "When scope genuinely cannot change, iterating on it is theater."),
                _quiz("The main purpose of WIP limits in Kanban is:",
                      ["Keeping managers informed", "Forcing finishing over starting and exposing bottlenecks",
                       "Making the board look tidy", "Measuring individual performance"], 1),
            ]),
        ]},
        {"title": "Stakeholders & closing the loop", "lessons": [
            A("pm-stake", "Stakeholder mapping & the communication plan", """A project succeeds when the people who can kill it don't want to. That's stakeholder management.

**Map on two axes — power × interest**
- **High power, high interest** → *manage closely*: weekly, personal, no surprises. (Sponsor, key department head.)
- **High power, low interest** → *keep satisfied*: short monthly summary, escalate only decisions. (Execs, finance.)
- **Low power, high interest** → *keep informed*: open demos, newsletter, community channel. (End users, adjacent teams.)
- **Low power, low interest** → *monitor*: nothing proactive.

**The map is dynamic** — a quiet department head becomes high-interest the week your change touches their KPI. Re-check monthly.

**The communication plan is just the map with a calendar**: who, what altitude (decisions vs. details), what channel, how often, who sends. One table, half a page.

**The golden rule: no surprises.** Bad news early is a plan; bad news late is a scandal. The sponsor should never learn about a slip from someone else — that's how PMs lose sponsors, and projects lose air cover."""),
            A("pm-retro", "Closure & post-mortems that change something", """Projects end twice: when the thing ships, and when the *organization learns* from it. Most skip the second.

**Closing checklist (one afternoon)**
- Success criteria from the charter: met / partially / missed — with numbers.
- Handover: who runs this now, and do they agree they run it?
- Open items → a named backlog, not an email thread.
- Thank-yous — specific ones (see SBI): people remember how projects *end*.

**The post-mortem (90 min, everyone, blameless)**
1. Timeline on the wall — facts first, memories disagree more than you think.
2. What went well (keep doing), what hurt (change), what we got lucky on (that's a risk for next time, not a success).
3. Pick **max 3 changes**, each with an owner and where it applies ("estimation: use reference class on all projects > 1 month").

**Blameless means systems, not saints**: ask "what made that mistake easy to make?" instead of "who did it?" People who fear post-mortems bring you fewer facts next time — and facts are the whole point.

File the 3 changes where the next project will trip over them (project template, checklist), not in a slide deck nobody reopens."""),
            Q("pm-quiz4", "Final check", [
                _quiz("Your sponsor is high-power / low-interest. The right communication is:",
                      ["A weekly 60-minute deep dive", "A short monthly summary + immediate escalation of decisions",
                       "Nothing — they're not interested", "Full access to the team's Kanban board"], 1),
                _quiz("The project slipped 3 weeks. When does the sponsor hear about it?",
                      ["At the next quarterly review", "As soon as the slip is likely, with options",
                       "Once the team has recovered the delay", "Never, if you can recover"], 1,
                      "Bad news early is a plan; bad news late costs you the sponsor's trust."),
                _quiz("A good post-mortem output is:",
                      ["A ranked list of who caused which delay", "Max 3 process changes, each with an owner",
                       "A 40-slide lessons-learned deck", "An anonymous complaints box"], 1),
            ]),
        ]},
    ]},
}

# --------------------------------------------------------------------------- #
# 3. UX Fundamentals for Non-Designers                                        #
# --------------------------------------------------------------------------- #

UX = {
    "title": "UX Fundamentals for Non-Designers",
    "summary": "See your product through users' eyes: personas, task flows, layout and form basics, accessibility quick wins, and usability tests with just 5 users.",
    "level": "beginner",
    "emoji": "🎨",
    "format": "virtual",
    "prerequisites": (
        "Aucun prérequis en design. Utile si vous concevez, spécifiez ou testez un outil interne."
    ),
    "tags": ["soft-skills", "ux", "design", "product"],
    "objectives": [
        "Explain UX as task success, not decoration",
        "Describe users with lightweight personas and jobs-to-be-done",
        "Structure a screen with visual hierarchy that guides the eye",
        "Design forms that people finish on the first try",
        "Apply the accessibility 20% that covers 80% of issues",
        "Run a 5-user usability test and turn findings into fixes",
    ],
    "curriculum": {"modules": [
        {"title": "Thinking like a user", "lessons": [
            A("ux-what", "What UX is (and isn't)", """UX is **not** how a product looks. It's whether a real person can **achieve their goal** without friction, error, or a manual.

A beautiful dashboard nobody can filter is bad UX. An ugly internal form that takes 40 seconds instead of 5 minutes is *great* UX.

**The hierarchy of UX quality**
1. **Useful** — does it solve a real task?
2. **Usable** — can a first-timer succeed without help?
3. **Efficient** — is the frequent path fast for the regular user?
4. **Pleasant** — only now do aesthetics enter.

Teams argue about level 4 while their product fails at level 2. Resist.

**The empathy gap**: you know your product too well to see it. You know where the button is, which errors are harmless, what the jargon means. Your users don't — and they won't tell you; they'll just quietly work around your tool in Excel.

> UX in one habit: **watch a real user try to complete a real task, once a month.** Everything else in this formation builds on what you'll see there."""),
            A("ux-personas", "Personas & jobs-to-be-done", """You can't design for "everyone" — you get the average of no one. Two lightweight tools fix this:

**Personas (the honest kind)**
Not marketing fiction with stock photos — a half-page per *distinct* user type, built from real conversations:
- context: role, frequency of use ("once a quarter" changes everything)
- top 3 tasks, in their words
- environment: device, time pressure, interruptions
- what makes them abandon

Two or three personas are plenty. If two personas would use the screen the same way, merge them.

**Jobs-to-be-done (JTBD)**
People don't want your feature — they *hire* it for a job:
> "When **[situation]**, I want to **[motivation]**, so I can **[outcome]**."

*"When the monthly close starts, I want to see which entities haven't submitted, so I can chase them today, not Friday."*

The JTBD format kills feature debates: instead of "should the table have export?", ask "which job needs the data outside the tool — and is export the best way to do that job?"

**Use them**: pin the personas next to any new screen design; write the JTBD at the top of every feature ticket. Decoration you don't use is worse than nothing."""),
            Q("ux-quiz1", "Check: user thinking", [
                _quiz("The best evidence your internal tool has a UX problem:",
                      ["The design looks dated", "Users keep a parallel Excel file to do the same job",
                       "A competitor uses nicer colors", "Management doesn't like the logo"], 1,
                      "Workarounds are users voting with their feet."),
                _quiz("A good JTBD statement is:",
                      ["\"Users want a dashboard\"", "\"When the close starts, I want to see missing entities so I can chase them today\"",
                       "\"The system shall display a table\"", "\"Millennials prefer mobile\""], 1),
            ]),
        ]},
        {"title": "Screens, flows & forms", "lessons": [
            A("ux-hierarchy", "Visual hierarchy: guiding the eye", """A screen without hierarchy makes the user do the designer's job — deciding what matters. Users don't read pages; they **scan** them (in an F-pattern, mostly top-left).

**The tools of hierarchy (in order of power)**
1. **Position** — top-left of the reading flow wins. Put the primary task there, not the logo's ego.
2. **Size** — one clearly biggest thing per screen. If everything is big, nothing is.
3. **Contrast & color** — one accent color for actions. When every button screams, users freeze (Hick's law: more choices = slower decisions).
4. **Whitespace** — grouping by proximity beats boxes and lines. Related things sit together; unrelated things breathe apart.

**The squint test**: blur your eyes at the screen. Can you still tell what it's about and what the main action is? If everything melts into equal gray noise — no hierarchy.

**One primary action per screen.** "Save" is solid and colored; "Cancel" is a quiet link. If two actions genuinely compete for primacy, you probably have two screens fighting inside one.

Count the fonts and colors while you're at it: two font sizes and one accent usually beat your current screen."""),
            A("ux-forms", "Forms that don't hurt", """Forms are where users suffer most — and where small fixes pay fastest.

**Layout**
- **One column.** Two-column forms create zigzag scanning and skipped fields.
- Labels **above** fields (not inside as placeholders — they vanish on first keystroke).
- Group into visible sections; show progress on multi-step ("Step 2 of 3").

**Ask less**
- Every field costs completions. For each one ask: *do we use this, today?* If not — cut, or mark optional.
- Derive what you can (city from postal code); default what's predictable (country, date = today).

**Errors — where forms are won or lost**
- Validate **inline, on leaving the field** — not as a red wall after submit.
- Say *what's wrong and how to fix it*: ❌ "Invalid input" → ✅ "The date must be in the future".
- **Never wipe the form on error.** Users forgive a mistake; they don't forgive retyping 20 fields.
- Keep the error visible next to the field *and* summarized at the top for long forms.

**The tab test**: complete your form using only the keyboard. If focus jumps randomly or a datepicker traps you, so is every power user — and every screen-reader user."""),
            A("ux-a11y", "Accessibility: the 20% that covers 80%", """Accessibility isn't a legal checkbox — it's usability under real conditions: sunlight on the screen, a broken mouse, aging eyes, a noisy open space. Fix these six things and you cover most of it:

1. **Contrast** — text needs 4.5:1 against its background (grey-on-grey aesthetics fail real eyes). Free checkers exist; use one.
2. **Don't rely on color alone** — red/green status dots are invisible to ~8% of men. Add an icon or a label: ✓ / ✕ beats 🟢 / 🔴.
3. **Keyboard everything** — all actions reachable by Tab/Enter, with a *visible* focus outline. (You just tested this on your form.)
4. **Real labels** — every input has a programmatic label; every meaningful image has alt text; icon-only buttons get an accessible name.
5. **Font size & zoom** — body text ≥ 14-16px, and the layout must survive 200% browser zoom without horizontal scrolling.
6. **Click targets** — at least ~44×44px on touch. Tiny ✕ icons punish everyone on a train.

**Test in 10 minutes**: unplug your mouse (test 3), squint (tests 1, 5), and run any automated checker (catches 4). Automated tools find ~30-40% of issues — the keyboard walk finds the rest of the big ones.

Accessible design is just… better design. Nobody has ever complained that text was too readable."""),
            Q("ux-quiz2", "Check: screens & forms", [
                _quiz("The 'squint test' checks:",
                      ["Color palette taste", "Whether hierarchy survives when detail disappears",
                       "Font licensing", "Loading performance"], 1),
                _quiz("A user submits a long form; one date is invalid. The worst response is:",
                      ["Inline error under the date field", "Error summary on top + field highlighted",
                       "Clearing the form and showing 'Invalid input'", "Keeping values and focusing the bad field"], 2),
                _quiz("A status shown ONLY as red/green dots fails which principle?",
                      ["Keyboard access", "Don't rely on color alone", "Click target size", "Zoom support"], 1),
            ]),
        ]},
        {"title": "Testing with users", "lessons": [
            A("ux-test", "Usability testing with 5 users", """You don't need a lab, a budget, or permission — you need **5 users, 30 minutes each**. Research (Nielsen) shows ~5 users uncover ~85% of usability problems; after that you're re-hearing the same ones.

**Prepare (1 hour)**
- 3-4 **tasks** as goals, not instructions: ✅ *"Find what the team spent on training in May"* — ❌ *"Click Reports, then filter by month"*.
- Realistic test data (empty screens hide problems).
- A note-taker if you can — the facilitator shouldn't scribble.

**Run (30 min per user)**
1. Disarm: *"We're testing the design, not you. You can't fail."*
2. Ask them to **think aloud** — the goal is hearing their model of the system.
3. **Stay silent.** When they're stuck, don't help — ask *"what would you try?"*. Every hint destroys the data.
4. Watch what they *do*, not what they *say* they'd do. ("It's fine" + 90 seconds of hunting = it's not fine.)

**Score simply**: per task per user — completed / struggled / failed. A task most users struggle with is your priority list, written by reality.

The hardest part is emotional: watching someone fail at your design and saying nothing. That discomfort is exactly the information you came for."""),
            A("ux-fixes", "Turning findings into fixes", """A pile of test notes changes nothing. Convert observations into shipped fixes:

**1. Findings, not opinions.**
Write each as *observation + evidence*: "4/5 users didn't find the export (looked in the table header; it lives in the sidebar)". No solutions yet — solutions too early anchor the team on the first idea.

**2. Prioritize on two axes** — severity × frequency:
- **Blocker for many** → fix before anything new ships.
- **Blocker for few / annoyance for many** → next sprint.
- **Cosmetic** → backlog, batch them.

**3. Cheapest fix first.** Most usability wins are embarrassingly small: rename a label to the user's word, move the button to where everyone looked, add one empty-state hint, set a default. If users hunted for "Export" in the table — put it on the table. Don't redesign the sidebar philosophy.

**4. Close the loop.** Re-test the fixed tasks with 2-3 users next round. And tell the original testers what changed because of them — they'll volunteer forever, and 'the tool team actually listens' is the best UX reputation you can buy.

**Cadence beats heroics**: 5 users every month outperforms a 30-user study every two years. Put it in the calendar and defend it."""),
            Q("ux-quiz3", "Final check", [
                _quiz("Why 5 users per test round?",
                      ["Statistics require at least 5", "~5 users surface most problems; more mostly repeats them",
                       "It's the legal minimum", "Fewer would be rude"], 1),
                _quiz("During a test the user is stuck. You should:",
                      ["Show them the button politely", "Ask 'what would you try?' and keep watching",
                       "End the task to save time", "Explain the design intent"], 1),
                _quiz("4/5 users failed to find a feature. The FIRST fix to try:",
                      ["A full redesign of the navigation", "Rename/move the entry point to where users actually looked",
                       "A tutorial video", "A tooltip on hover"], 1),
            ]),
        ]},
    ]},
}

FORMATIONS = [COMMS, PM, UX]

# formation title -> [(handle, status, fraction done)]
ENROLLMENTS = {
    "Effective Communication & Feedback": [
        ("sara.amrani", "completed", 1.0),
        ("mohannad.tazi", "active", 0.5),
        ("nadia.bouzid", "active", 0.4),
        ("abdelghafour.lahrache", "active", 0.25),
        ("omar.tazi", "invited", 0.0),
    ],
    "Project Management Essentials": [
        ("imane.zahraoui", "completed", 1.0),
        ("salaheddine.elbaidoury", "active", 0.6),
        ("karim.mansouri", "active", 0.5),
        ("youssef.benali", "active", 0.3),
        ("hicham.raji", "active", 0.15),
    ],
    "UX Fundamentals for Non-Designers": [
        ("yasmine.alaoui", "completed", 1.0),
        ("salma.elbarbori", "active", 0.7),
        ("mehdi", "active", 0.2),
        ("salma.idrissi", "invited", 0.0),
    ],
}

# day offset from next Monday, local HH:MM, formation title, session fields
SESSIONS = [
    (1, "11:00", "Effective Communication & Feedback",
     "Workshop: feedback role-plays", "Practice SBI live in pairs — bring one real situation.", 90,
     "Room Atlas, HQ Casablanca", "https://teams.microsoft.com/l/meetup-join/demo-comms-workshop"),
    (2, "14:00", "Project Management Essentials",
     "Case study: rescue a slipping project", "Group exercise on a real (anonymized) Managem project plan.", 120,
     "Room Toubkal, HQ Casablanca", "https://teams.microsoft.com/l/meetup-join/demo-pm-case"),
    (4, "10:00", "UX Fundamentals for Non-Designers",
     "Live usability test — watch real users", "We test one of our internal tools with 3 volunteers, live.", 60,
     "Online", "https://teams.microsoft.com/l/meetup-join/demo-ux-live"),
]


def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        exists = db.query(Formation).filter(Formation.title == COMMS["title"]).first()
        if exists and not force:
            print("Soft-skills formations already seeded — use --force to re-apply.")
            return

        handle, name = TRAINER
        trainer = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
        if not trainer:
            trainer = Learner(handle=handle, name=name, xp=290)
            db.add(trainer)
            db.flush()
        trainer.name = trainer.name or name
        trainer.email = trainer.email or f"{handle}@aida.local"
        if trainer.role == "user":
            trainer.role = "trainer"

        created = {}
        for spec in FORMATIONS:
            f = db.query(Formation).filter(Formation.title == spec["title"]).first()
            if not f:
                f = Formation(
                    title=spec["title"], summary=spec["summary"], level=spec["level"],
                    emoji=spec["emoji"], tags=spec["tags"], objectives=spec["objectives"],
                    prerequisites=spec["prerequisites"], format=spec["format"],
                    curriculum=spec["curriculum"],
                    trainer_id=trainer.id, trainer_name=trainer.name or trainer.handle,
                    status="published", open_enrollment=True,
                )
                db.add(f)
                db.flush()
            else:
                f.curriculum = spec["curriculum"]
                f.objectives = spec["objectives"]
                f.summary = spec["summary"]
                f.prerequisites = spec["prerequisites"]
                f.format = spec["format"]
            created[f.title] = f

        for title, rows in ENROLLMENTS.items():
            f = created[title]
            ids = lesson_ids(f.curriculum)
            for handle, status, frac in rows:
                member = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
                if not member:
                    continue
                enr = db.query(FormationEnrollment).filter_by(
                    formation_id=f.id, learner_id=member.id
                ).first()
                if not enr:
                    enr = FormationEnrollment(
                        formation_id=f.id, learner_id=member.id, invited_by=f.trainer_name
                    )
                    db.add(enr)
                enr.status = status
                done = {
                    c.lesson_id for c in db.query(FormationLessonCompletion).filter_by(
                        learner_id=member.id, formation_id=f.id
                    )
                }
                for lid in ids[: round(len(ids) * frac)]:
                    if lid not in done:
                        db.add(FormationLessonCompletion(
                            learner_id=member.id, formation_id=f.id, lesson_id=lid
                        ))

        monday = TODAY + dt.timedelta(days=(7 - TODAY.weekday()) % 7 or 7)
        db.query(FormationSession).filter(
            FormationSession.formation_id.in_([f.id for f in created.values()])
        ).delete(synchronize_session=False)
        for day, hhmm, title, s_title, s_desc, minutes, location, url in SESSIONS:
            f = created[title]
            hour, minute = map(int, hhmm.split(":"))
            local = dt.datetime.combine(monday + dt.timedelta(days=day), dt.time(hour, minute))
            db.add(FormationSession(
                formation_id=f.id, title=s_title, description=s_desc,
                starts_at=(local - LOCAL_UTC_OFFSET).replace(tzinfo=dt.timezone.utc),
                duration_min=minutes, location=location, meeting_url=url,
            ))

        db.commit()
        print("Soft-skills formations seeded:")
        for spec in FORMATIONS:
            n = len(lesson_ids(spec["curriculum"]))
            print(f"  {spec['title']} - {n} lessons, trainer {trainer.handle}")
        print(f"  enrollments: {sum(len(v) for v in ENROLLMENTS.values())}, sessions: {len(SESSIONS)}")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
