# What L&D can and cannot do

The L&D lead (`hr_lead`) — Aicha's role. Audited against the running stack:
every line below was measured by calling the API as her and comparing the
answer with an `admin` and a plain `user`, then walking the screens.

The one sentence that explains the whole design: **L&D runs the people and the
learning; the administrator runs the platform.** Reporting, org structure,
assignment and approval are hers. Roles that grant platform power, feature
switches, labs and deletions are not.

---

## 1. The screens she gets

Seventeen entries, against eleven for a learner. The five that are hers alone:

| Screen | What she does there |
|---|---|
| **Organization** `/org` | HR analytics for the whole company — UpSkill, Coursera, or both. Export to Excel and PDF. |
| **Reports** `/reports` | Build-your-own reporting: group, measure, filter, save and share views. Periodic PDF reports. |
| **Tracking** `/mandatory` | Every assignment in the organisation, and the **Assign learning** campaign wizard. |
| **Governance** `/admin/governance` | Business units, heads, HR perimeters, practices, teams, people, invitations. |
| **Onboarding** `/admin/onboarding` | What a new colleague is asked on day one, and which skills each answer preselects. |

Plus **My Team** (`/team`), which she sees as an overseer, and everything a
learner has.

## 2. What she can do

**Reporting — organisation-wide.** Scope reads *Toute l'organisation*: 237
collaborators in the HR view, every BU, every team. An HRBP (`hr`) gets the
same screens narrowed to their assigned perimeter; L&D is not narrowed.

**Assigning.** The campaign wizard: any number of courses, trainings and
pathways, to named people, teams, business units or practices at once,
mandatory or recommended, with a deadline and a reason. A preview names exactly
who is in scope and who already has it before anything is written. One email
per person, in their own language, plus an in-app notification.

**Approving.** `can_decide: true`, scope `org` — she is the second stage of
every training request in the company, after the line manager.

**The organisation itself.** Create, rename, reorder and archive business
units; appoint BU heads; set HR perimeters; create teams and set their
managers; edit any of the 277 people — name, job title, grade, practice, site,
employee number, BU, team, **and role**.

**Opening accounts.** *Invite a collaborator* creates the account and sends the
welcome mail. She can also set and reset passwords (`/auth/password/set`),
which matters because there is no self-service reset.

**Onboarding.** Edit the first-connection questions, their labels in both
languages, and the skills each answer preselects.

## 3. What she cannot do

| Refused | Why, and what she sees |
|---|---|
| Grant the **admin** role | 403 — *"Seul un administrateur plateforme peut accorder le rôle admin."* Platform power is granted by platform owners. |
| The **feature switchboard** | 404 — which modules a deployment runs is a platform decision, not a people one. |
| **Platform stats and labs admin** (`/admin/*`) | 403. |
| **Edit somebody else's course** | 403 — she curates through the approvals queue, she does not rewrite other people's material. |
| Anything **destructive at platform level** — deleting labs, integrations | admin only. |

She also cannot see a module that is switched off, the same as anyone else: a
flag that is off is off for everybody, including the people who set it.

---

## 4. Defects this audit found, and fixed

| What was wrong | Why it mattered |
|---|---|
| **The role dropdown offered "Administrator" to L&D.** The server correctly refuses (403), so she could pick it, press Save and be told no. | A door advertised to somebody who cannot open it — the exact failure the navigation rules exist to prevent. The option is now only shown to a platform admin. |
| **`/admin/*` answered 403 to an administrator** who signed in with an email and password. `require_admin` only recognised an Entra SSO admin or the server's admin token. | Adding password sign-in quietly locked admins out of their own admin screens unless they went and found the server token — while `/admin/switchboard`, which checks the role, let them straight in. Two doors to the same room, one locked for no reason. |
| **`_can_edit` on courses recognised an admin only by the admin token**, so an administrator signed in normally could not touch anyone else's course. | Same class of bug. The role is what makes somebody an admin; the token is one way of proving it, not the definition. |
| **The sidebar still read "UpSkill · Academy"** | Left over from the AI & Data framing, on a platform now serving every unit. |

## 5. Worth deciding

- **The BU-head dropdown lists all 277 people with no search.** It works, but
  picking a head means scrolling a 277-row select. A search box, as the people
  tab already has, would cost little.
- **L&D can edit anyone's role up to `hr_lead`.** That includes promoting
  someone to `hr_lead`, which is her own level. Defensible — she owns the
  people function — but it is the one place where the people/platform line is
  thinner than it looks, and worth a conscious yes.
- **No audit trail on governance edits.** Role changes notify the person, but
  nothing records who changed a BU, a perimeter or a job title, or when. For a
  screen that decides what managers and HR can see, that is a gap.
- **No bulk people operations.** Moving twelve people to a new BU is twelve
  edits. The campaign wizard shows the pattern that would fix it.
