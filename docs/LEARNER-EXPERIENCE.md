# What a colleague sees — the simple learner, end to end

Audited on the launch configuration (`app/ops_launch_config.py`): Collaborate,
Labs and Stacks switched off; the Leaderboard kept for staff only. Checked
against a real `role = user` account (`demo.learner@teal.ma`), both through the
screens and against the API.

The platform tells this person apart from everybody else by one field: `role`.
A learner is `user`. Every other role — trainer, manager, bu_head, hr, hr_lead,
admin — adds surface on top of this.

---

## 1. What they see

Eleven entries in the sidebar, and nothing else:

| | Screen | What it is for them |
|---|---|---|
| **Overview** | Dashboard | Level, XP, streak, weekly goal, what is waiting for them |
| | Approvals | What *they* asked for, and where it got to |
| **Learn** | Trainings | The catalogue, plus the ones they joined |
| | Pathways | Curated journeys; the ones assigned to them show a deadline |
| | Courses | 833 entries, internal and Coursera, filterable |
| | Certifications | The catalogue, and the ones they hold |
| **My space** | Settings | Their account, language, weekly goal, password |
| | My learning | Their whole record: done, in progress, due |
| | My Profile | Level, badges, streak, skill tree, certificates |
| | My skills | Self-rating and the gap against their role profile |

Approvals appears for everyone on purpose: a collaborator sees *their own*
requests there, which is the other half of the same screen a manager uses.

**What is refused, and how.** Everything else answers 403 — HR analytics, the
report builder, assignment tracking, governance, team dashboards, the admin
surface (which answers 404, because "forbidden" confirms a thing exists).
Switched-off modules answer 404 as well, from middleware, before their router
is reached: a hidden menu entry is not security, and the URL survives in
bookmarks and old emails.

---

## 2. What they can change

Everything a learner controls is on **Settings**, and it is a short list:

| They control | They cannot |
|---|---|
| Display name | Their email, handle or XP |
| Interface + email language (fr/en) | Their BU, practice, team, title, grade, site, employee number |
| Weekly learning goal (15/30/60/120 min) | Their role |
| Their password | Anyone else's anything |

The org block says plainly: *"Set by HR. If something here is wrong, tell them —
it decides what your managers and HR can see."* That is the right framing: the
fields are not theirs to edit, and the page says why rather than greying them
out silently.

Password rules worth knowing: 12 characters minimum, five wrong attempts locks
the account for five minutes, and changing it signs out every other device.
There is **no self-service reset** — L&D or an admin sets a new one. That is a
deliberate gap: a reset link needs a mailed one-time token, and an unmailed one
is a reset anybody could trigger.

---

## 3. How they start learning

Four ways in, in the order a new joiner meets them:

1. **The onboarding wizard**, on first sign-in. Three questions ("What
   describes you best?") and the platform proposes a pathway. It can be skipped,
   and `onboarded` stays false until it is finished.
2. **Assigned work.** L&D or their manager assigns a course, training or
   pathway, optionally mandatory and with a deadline. They are notified in-app
   and by email, and the item appears under *Waiting for you* on the dashboard
   and in *My learning*.
3. **Self-service.** Any published training with open enrolment has a **Join
   training** button; invite-only ones show *Invite-only · details →* instead,
   so the difference is visible before the click. Courses and pathways are the
   same: open the catalogue, start.
4. **A join code**, for a training a trainer runs for a specific group.

Once started, progress is recorded per lesson, and a Coursera course inside a
training or pathway ticks itself off when the provider reports it finished.

---

## 4. What reaches them, unprompted

**In-app** (the bell, `/api/notifications`) — nineteen kinds, of which a
learner actually receives:

| Kind | Fires when |
|---|---|
| `assignment` | Something is assigned to them, by name or with their team |
| `invite` / `enrollment` | A trainer invites them, or their enrolment is confirmed |
| `session` | A session they are registered for is created, moved or cancelled |
| `approval` | Their training request advances or is decided |
| `cert_suggested` / `cert_earned` / `cert_expiring` | A certificate is suggested, recorded, or coming up for renewal |
| `comment` | Somebody replies on content they follow |
| `goal` | Their weekly goal is met |
| `team` / `role` / `pathway` | They join a team, their role changes, a pathway is given to them |

**By email** — assignments, training invitations, session invitations and
changes, certificate renewal reminders, the welcome mail when their account is
opened, and a **weekly digest** on Monday mornings (06:30 UTC).

**Scheduled jobs behind that:** certificate reminders daily at 07:00 UTC, the
Coursera sync nightly at 05:00, the digest on Mondays. All three need the
`worker` and `beat` processes running — without them nothing is sent, silently.

**What they cannot choose.** There is no per-type notification preference and
no unsubscribe: a learner gets everything addressed to them, in their chosen
language. For a compliance-bearing platform that is defensible — the mandatory
reminder is the point — but it is a real gap for the digest, which is the one
message somebody might reasonably want to stop. Worth a preference before a
wide rollout.

---

## 5. Defects this audit found, and fixed

| What was wrong | Why it mattered |
|---|---|
| **Schedule showed `Error: Not Found`** | Its menu entry was not tied to the sessions module, so switching sessions off left a dead page in everyone's sidebar. Now bound to the `sessions` switch. |
| **A typed URL reached a broken page** | `/labs` rendered an error instead of an explanation. A `FeatureGate` now says *"Not part of your platform"* and offers the way back. |
| **The dashboard sold the wrong product** | The hero read *"Hands-on labs graded live, a local-tools toolbox, an AI tutor…"* with a **Start a lab** button, on a deployment with labs off — the exact criticism the feedback raised. The copy and the primary action now follow the configuration. |
| **Four weekly quests nobody could complete** | Every quest counts lab steps and SQL exercises. With labs off they sat at 0/4 forever, which reads as a broken product rather than a narrowed one. Hidden with labs. |
| **"Top learners" shown to learners** | The leaderboard preview and the *Rank* stat ignored the switch, so a learner saw their place in a ranking they could not open. Both follow the leaderboard now. |
| **Settings lied about sign-in** | A password account was told *"Demo sign-in has no password"* immediately above the form that changes that password. The account API now reports `azure` / `password` / `handle` honestly. |

---

## 6. Still open, worth deciding

- **No notification preferences.** Everything or nothing, and nothing is not an
  option. The weekly digest is the first candidate for an opt-out.
- **No self-service password reset.** Every forgotten password is an L&D ticket
  until a mailed reset token exists.
- **The onboarding wizard can be skipped** and never offered again; `onboarded`
  stays false and nothing chases it.
- **An empty account looks empty.** A learner with nothing assigned sees zeros
  and *"Nothing personal yet"*. The catalogue is one click away, but the first
  screen does not lead there. A seeded "start here" pathway for new joiners
  would fix the cold start — `auto_assign` on a pathway already does exactly
  this and is not being used.
- **833 courses, no recommendation** for someone who skipped onboarding. The
  AI suggestion panel is tied to labs and is now hidden with them.
