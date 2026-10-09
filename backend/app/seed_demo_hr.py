"""Seed a polished HR-demo dataset: two teams with Skill Leads, learners with
varied XP/streaks/badges, formations with realistic progress, and a week of
scheduled live sessions.

Run inside the backend container:
    python -m app.seed_demo_hr [--force]

Idempotent-ish: refuses to run twice unless --force (which re-applies stats and
recreates enrollments/sessions for the demo entities it owns).
"""

import datetime as dt
import sys

from app.db.session import SessionLocal
from app.labs import registry
from app.models import (
    Achievement,
    Certification,
    CertificationSuggestion,
    EarnedCertificate,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    FormationSession,
    Learner,
    StepCompletion,
    Team,
)
from app.schemas.formation import lesson_ids

TODAY = dt.date.today()
# Sessions are entered as Morocco local time (UTC+1 in July) and stored UTC.
LOCAL_UTC_OFFSET = dt.timedelta(hours=1)

# Leftovers from earlier API testing — replaced by the polished cast below.
OLD_TEST_HANDLES = ["lead-sarah", "dev-yassine", "dev-imane"]
OLD_TEST_TEAM = "Data Engineering Squad"
OLD_TEST_FORMATION = "Prompt Engineering Bootcamp"

# handle, display name, role, xp, streak, days since last activity (None = long ago)
PEOPLE = [
    # Trainer for the new formations
    ("rachid.berrada", "Rachid Berrada", "trainer", 610, 3, 0),
    # HR responsible — org-wide people view (/org)
    ("khalid.ou", "Khalid Ou", "hr", 30, 0, 2),
    # Team Data & BI — Casablanca
    ("salma.idrissi", "Salma Idrissi", "trainer", 140, 0, 4),
    ("hicham.raji", "Hicham Raji", "manager", 75, 1, 1),
    ("youssef.benali", "Youssef Benali", "user", 455, 8, 0),
    ("imane.zahraoui", "Imane Zahraoui", "user", 520, 12, 1),
    ("sara.amrani", "Sara Amrani", "user", 95, 0, 6),
    # Team GenAI Guild — Marrakech
    ("karim.mansouri", "Karim Mansouri", "trainer", 210, 2, 1),
    ("leila.senhaji", "Leila Senhaji", "manager", 45, 0, 3),
    ("nadia.bouzid", "Nadia Bouzid", "user", 320, 5, 0),
    ("omar.tazi", "Omar Tazi", "user", 60, 0, 11),
    ("yasmine.alaoui", "Yasmine Alaoui", "user", 380, 1, 2),
]

# handle → (bu, practice, location, matricule, job_level)
ORG_PROFILES: dict[str, tuple[str, str, str, str, str]] = {
    "rachid.berrada": ("Digital & Data", "Learning & Enablement", "Casablanca", "EMP-1001", "Senior Trainer"),
    "khalid.ou": ("Corporate HR", "People Analytics", "Rabat", "EMP-1002", "HR Business Partner"),
    "salma.idrissi": ("Data & Analytics", "Business Intelligence", "Casablanca", "EMP-2010", "Skill Lead"),
    "hicham.raji": ("Data & Analytics", "Business Intelligence", "Casablanca", "EMP-2011", "Manager"),
    "youssef.benali": ("Data & Analytics", "Business Intelligence", "Casablanca", "EMP-2012", "Senior Consultant"),
    "imane.zahraoui": ("Data & Analytics", "Data Engineering", "Casablanca", "EMP-2013", "Consultant"),
    "sara.amrani": ("Data & Analytics", "Business Intelligence", "Casablanca", "EMP-2014", "Junior Consultant"),
    "karim.mansouri": ("Digital Factory", "GenAI & Automation", "Marrakech", "EMP-3010", "Skill Lead"),
    "leila.senhaji": ("Digital Factory", "GenAI & Automation", "Marrakech", "EMP-3011", "Manager"),
    "nadia.bouzid": ("Digital Factory", "GenAI & Automation", "Marrakech", "EMP-3012", "Consultant"),
    "omar.tazi": ("Digital Factory", "Cloud & DevOps", "Marrakech", "EMP-3013", "Junior Consultant"),
    "yasmine.alaoui": ("Digital Factory", "GenAI & Automation", "Marrakech", "EMP-3014", "Senior Consultant"),
}

TEAMS = [
    ("Data & BI — Casablanca", "Analytics, reporting & data engineering squad",
     "salma.idrissi", "hicham.raji",
     ["youssef.benali", "imane.zahraoui", "sara.amrani", "mehdi"]),
    ("GenAI Guild — Marrakech", "Cross-functional GenAI adoption group",
     "karim.mansouri", "leila.senhaji",
     ["nadia.bouzid", "omar.tazi", "yasmine.alaoui", "sofia"]),
]


def _quiz(question: str, options: list[str], answer: int) -> dict:
    return {"question": question, "options": options, "answer_index": answer, "explanation": ""}


DQ_CURRICULUM = {
    "modules": [
        {
            "title": "Why data quality matters",
            "lessons": [
                {"id": "dq-intro", "title": "The real cost of bad data", "type": "article",
                 "body_md": "Bad data silently breaks dashboards, ML models and decisions. "
                            "In this formation you'll learn the six data-quality dimensions and how to test them.",
                 "xp": 10, "duration_min": 6},
                {"id": "dq-dimensions", "title": "The six DQ dimensions", "type": "article",
                 "body_md": "**Completeness, uniqueness, validity, consistency, accuracy, timeliness** — "
                            "with real examples of each failing in a mining-industry ERP.",
                 "xp": 10, "duration_min": 8},
                {"id": "dq-quiz-1", "title": "Check your understanding", "type": "quiz", "xp": 15,
                 "duration_min": 5,
                 "questions": [
                     _quiz("A column of national IDs contains duplicates. Which dimension fails?",
                           ["Timeliness", "Uniqueness", "Accuracy", "Completeness"], 1),
                     _quiz("Null rates suddenly jump from 2% to 40%. Which dimension fails?",
                           ["Completeness", "Validity", "Consistency", "Uniqueness"], 0),
                 ]},
            ],
        },
        {
            "title": "Testing data in practice",
            "lessons": [
                {"id": "dq-profiling", "title": "Profiling a table before trusting it", "type": "article",
                 "body_md": "Row counts, null rates, distinct counts, min/max sanity — the 10-minute profile "
                            "that catches 80% of issues.",
                 "xp": 10, "duration_min": 7},
                {"id": "dq-checks", "title": "Writing your first automated checks", "type": "article",
                 "body_md": "Turning profile findings into repeatable checks: not-null, unique, "
                            "accepted ranges, referential integrity.",
                 "xp": 15, "duration_min": 10},
                {"id": "dq-quiz-2", "title": "Final quiz", "type": "quiz", "xp": 20, "duration_min": 5,
                 "questions": [
                     _quiz("Which check protects a foreign-key relationship?",
                           ["Range check", "Referential integrity", "Null check", "Freshness check"], 1),
                 ]},
            ],
        },
    ]
}

BIZ_CURRICULUM = {
    "modules": [
        {
            "title": "GenAI without the jargon",
            "lessons": [
                {"id": "biz-what", "title": "What LLMs can and can't do", "type": "article",
                 "body_md": "A manager-friendly tour: strengths (drafting, summarising, extraction), "
                            "limits (hallucination, freshness) and what that means for your team.",
                 "xp": 10, "duration_min": 8},
                {"id": "biz-usecases", "title": "Spotting good use cases", "type": "article",
                 "body_md": "A simple filter: repetitive + language-heavy + human-reviewed = great first use case.",
                 "xp": 10, "duration_min": 7},
                {"id": "biz-quiz", "title": "Quick check", "type": "quiz", "xp": 15, "duration_min": 4,
                 "questions": [
                     _quiz("Which task is the SAFEST first GenAI pilot?",
                           ["Automatic contract signing", "Drafting meeting summaries for review",
                            "Unsupervised customer refunds", "Real-time market trading"], 1),
                 ]},
            ],
        },
    ]
}

# formation title -> [(handle, status, fraction_of_lessons_done)]
ENROLLMENTS = {
    "Prompt Engineering for GenAI": [
        ("youssef.benali", "active", 0.6),
        ("imane.zahraoui", "completed", 1.0),
        ("sara.amrani", "active", 0.2),
        ("nadia.bouzid", "active", 0.45),
        ("omar.tazi", "invited", 0.0),
        ("yasmine.alaoui", "active", 0.75),
    ],
    "Data Quality Fundamentals": [
        ("mehdi", "active", 0.5),
        ("yasmine.alaoui", "completed", 1.0),
        ("youssef.benali", "active", 0.15),
        ("sofia", "active", 0.35),
        ("sara.amrani", "invited", 0.0),
    ],
    "GenAI for Business Teams": [
        ("nadia.bouzid", "completed", 1.0),
        ("omar.tazi", "active", 0.34),
        ("salma.idrissi", "active", 0.67),
        ("karim.mansouri", "active", 0.34),
    ],
}

# name, provider, level, url, description
CERTIFICATIONS = [
    ("Microsoft Azure Data Fundamentals (DP-900)", "Microsoft", "beginner",
     "https://learn.microsoft.com/credentials/certifications/azure-data-fundamentals/",
     "Cloud data concepts — the baseline for everyone touching Azure data services."),
    ("Microsoft Azure AI Fundamentals (AI-900)", "Microsoft", "beginner",
     "https://learn.microsoft.com/credentials/certifications/azure-ai-fundamentals/",
     "AI & ML concepts on Azure — a great first step before the GenAI formations."),
    ("dbt Fundamentals", "dbt Labs", "beginner",
     "https://learn.getdbt.com/courses/dbt-fundamentals",
     "Models, tests and docs in dbt — pairs perfectly with the data-quality track."),
    ("Databricks Data Engineer Associate", "Databricks", "intermediate",
     "https://www.databricks.com/learn/certification/data-engineer-associate",
     "Lakehouse pipelines, Delta and orchestration on Databricks."),
    ("AWS Certified Data Engineer — Associate", "AWS", "intermediate",
     "https://aws.amazon.com/certification/certified-data-engineer-associate/",
     "Design and operate data pipelines on AWS."),
]

# cert name, team name, suggester handle, note
CERT_SUGGESTIONS = [
    ("Microsoft Azure Data Fundamentals (DP-900)", "Data & BI — Casablanca", "hicham.raji",
     "Baseline for the Azure migration — target: everyone certified by Q4."),
    ("dbt Fundamentals", "Data & BI — Casablanca", "salma.idrissi",
     "Free, short, and pairs with the Data Quality formation."),
    ("Microsoft Azure AI Fundamentals (AI-900)", "GenAI Guild — Marrakech", "leila.senhaji",
     "Good first step before the prompt-engineering formation."),
]

# handle, cert name (or None), free title, issuer, days ago, credential url, expires in days (None = no expiry)
EARNED_CERTS = [
    ("imane.zahraoui", "Microsoft Azure Data Fundamentals (DP-900)", "", "", 21,
     "https://learn.microsoft.com/api/credentials/share/demo-imane-dp900", 30),
    ("yasmine.alaoui", "dbt Fundamentals", "", "", 10,
     "https://credentials.getdbt.com/demo-yasmine", 120),
    ("youssef.benali", None, "Kaggle Intermediate Machine Learning", "Kaggle", 5,
     "https://www.kaggle.com/learn/certification/demo-youssef", None),
    ("nadia.bouzid", "Microsoft Azure AI Fundamentals (AI-900)", "", "", 2,
     "https://learn.microsoft.com/api/credentials/share/demo-nadia-ai900", -1),
]

# day offset from next Monday, local time HH:MM, formation title, session fields
SESSIONS = [
    (0, "09:30", "Prompt Engineering for GenAI",
     "Kickoff — cohort 2", "Welcome, tooling check and program overview.", 60,
     "Room Atlas, HQ Casablanca", "https://teams.microsoft.com/l/meetup-join/demo-kickoff"),
    (1, "14:00", "Data Quality Fundamentals",
     "Workshop: profiling real datasets", "Bring one of your own tables — we profile it live.", 90,
     "Online", "https://teams.microsoft.com/l/meetup-join/demo-dq-workshop"),
    (2, "10:00", "Prompt Engineering for GenAI",
     "Live workshop: few-shot prompting", "Hands-on session on the playground lessons of module 2.", 120,
     "Room B2, HQ Casablanca", "https://teams.microsoft.com/l/meetup-join/demo-fewshot"),
    (3, "11:00", "GenAI for Business Teams",
     "Intro session & Q&A", "Open to all managers — no technical background needed.", 45,
     "Online", "https://teams.microsoft.com/l/meetup-join/demo-biz-intro"),
    (4, "15:00", "Prompt Engineering for GenAI",
     "Office hours with the trainer", "Drop in with your prompt challenge questions.", 45,
     "Online", "https://teams.microsoft.com/l/meetup-join/demo-office-hours"),
    (7, "09:00", "Data Quality Fundamentals",
     "Graded challenge review", "Walkthrough of the final quiz and next steps.", 60,
     "Room Toubkal, HQ Casablanca", ""),
]


def _next_monday(today: dt.date) -> dt.date:
    return today + dt.timedelta(days=(7 - today.weekday()) % 7 or 7)


def _get_or_create_learner(db, handle: str, name: str | None = None, role: str = "user") -> Learner:
    learner = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
    if not learner:
        learner = Learner(handle=handle, name=name)
        db.add(learner)
        db.flush()
    if name and not learner.name:
        learner.name = name
    if learner.role == "user" and role != "user":
        learner.role = role
    return learner


def _badges_for(xp: int, streak: int, steps: int) -> list[str]:
    out = []
    if steps > 0:
        out.append("first_steps")
    if xp >= 100:
        out.append("centurion")
    if xp >= 500:
        out.append("high_roller")
    if steps >= 10:
        out.append("on_a_roll")
    if streak >= 7:
        out.append("week_warrior")
    if steps >= 5:
        out.append("explorer")
    return out


def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        if db.query(Team).filter(Team.name == TEAMS[0][0]).first() and not force:
            print("HR demo data already seeded — use --force to re-apply.")
            return

        # ---- 1. Remove earlier throwaway test data -------------------------
        old_formation = db.query(Formation).filter(Formation.title == OLD_TEST_FORMATION).first()
        if old_formation:
            db.delete(old_formation)  # sessions/enrollments cascade at DB level
        old_team = db.query(Team).filter(Team.name == OLD_TEST_TEAM).first()
        if old_team:
            db.query(Learner).filter(Learner.team_id == old_team.id).update({"team_id": None})
            db.delete(old_team)
        for handle in OLD_TEST_HANDLES:
            stale = db.query(Learner).filter(Learner.handle == handle).first()
            if stale:
                db.delete(stale)
        db.flush()

        # ---- 2. People with lived-in stats --------------------------------
        # Real (lab_id, step_id) pairs so lab-completion counts look genuine.
        steps_pool = [
            (lab.id, step.id)
            for lab in registry.all_labs(db)
            for step in lab.steps
        ]
        learners: dict[str, Learner] = {}
        for i, (handle, name, role, xp, streak, days_ago) in enumerate(PEOPLE):
            l = _get_or_create_learner(db, handle, name, role)
            l.email = l.email or f"{handle}@aida.local"  # so invite emails land in MailHog
            l.xp = max(l.xp, xp)
            l.current_streak = streak
            l.longest_streak = max(streak, l.longest_streak or 0, 4)
            l.last_active_on = TODAY - dt.timedelta(days=days_ago) if days_ago is not None else None
            org = ORG_PROFILES.get(handle)
            if org:
                l.bu, l.practice, l.location, l.matricule, l.job_level = org
            learners[handle] = l

            n_steps = min(len(steps_pool), max(0, xp // 45))
            existing = {
                (c.lab_id, c.step_id)
                for c in db.query(StepCompletion).filter_by(learner_id=l.id)
            }
            # stagger the slice per person so profiles don't look identical
            for lab_id, step_id in steps_pool[i % 3: i % 3 + n_steps]:
                if (lab_id, step_id) not in existing:
                    db.add(StepCompletion(learner_id=l.id, lab_id=lab_id, step_id=step_id, xp_awarded=15))
            done_badges = {
                a.badge_id for a in db.query(Achievement).filter_by(learner_id=l.id)
            }
            for badge in _badges_for(xp, streak, n_steps):
                if badge not in done_badges:
                    db.add(Achievement(learner_id=l.id, badge_id=badge))
        db.flush()

        # ---- 3. Teams ------------------------------------------------------
        for name, desc, lead_handle, manager_handle, member_handles in TEAMS:
            team = db.query(Team).filter(Team.name == name).first()
            if not team:
                team = Team(name=name, description=desc)
                db.add(team)
                db.flush()
            lead = learners.get(lead_handle) or _get_or_create_learner(db, lead_handle, role="trainer")
            if lead.role == "user":
                lead.role = "trainer"
            team.lead_id = lead.id
            manager = learners.get(manager_handle) or _get_or_create_learner(db, manager_handle, role="manager")
            if manager.role == "user":
                manager.role = "manager"
            team.manager_id = manager.id
            for mh in member_handles:
                member = learners.get(mh) or db.query(Learner).filter(Learner.handle.ilike(mh)).first()
                if member:
                    member.team_id = team.id
        db.flush()

        # ---- 4. Formations -------------------------------------------------
        trainer = learners["rachid.berrada"]
        formations: dict[str, Formation] = {}
        existing_pe = db.query(Formation).filter(
            Formation.title == "Prompt Engineering for GenAI"
        ).first()
        if existing_pe:
            formations[existing_pe.title] = existing_pe

        for title, summary, level, emoji, tags, curriculum, open_enr, objectives, fmt, prereq in [
            ("Data Quality Fundamentals",
             "Learn the six data-quality dimensions and how to profile and test any table before trusting it.",
             "beginner", "🧪", ["data-quality", "sql", "governance"], DQ_CURRICULUM, False,
             [
                 "Nommer les six dimensions de la qualité des données et les reconnaître sur un cas réel",
                 "Profiler une table en 10 minutes pour repérer 80 % des problèmes",
                 "Transformer un constat de profiling en checks automatisés et répétables",
                 "Choisir le bon check selon le problème (not-null, unicité, plage, intégrité référentielle)",
             ],
             "hybrid",
             "Des bases en SQL (SELECT, WHERE, JOIN) sont recommandées pour l'atelier de profiling. "
             "Aucune expérience en qualité de données n'est nécessaire."),
            ("GenAI for Business Teams",
             "A no-code introduction to GenAI for managers: what it does well, where it fails, and how to pick pilots.",
             "beginner", "💼", ["genai", "business", "adoption"], BIZ_CURRICULUM, True,
             [
                 "Expliquer avec vos mots ce qu'un LLM sait faire — et ce qu'il ne sait pas faire",
                 "Repérer un bon premier cas d'usage GenAI dans votre équipe",
                 "Écarter les cas d'usage risqués avant d'y investir du temps",
             ],
             "virtual",
             "Aucun prérequis — formation conçue pour les managers et les équipes métier, sans code."),
        ]:
            f = db.query(Formation).filter(Formation.title == title).first()
            if not f:
                f = Formation(
                    title=title, summary=summary, level=level, emoji=emoji, tags=tags,
                    objectives=objectives, prerequisites=prereq, format=fmt,
                    curriculum=curriculum,
                    trainer_id=trainer.id, trainer_name=trainer.name or trainer.handle,
                    status="published", open_enrollment=open_enr,
                )
                db.add(f)
                db.flush()
            else:
                f.objectives = f.objectives or objectives
                f.prerequisites = f.prerequisites or prereq
                f.format = f.format or fmt
            formations[title] = f

        # ---- 5. Enrollments with varied progress ----------------------------
        for title, rows in ENROLLMENTS.items():
            formation = formations.get(title)
            if not formation:
                continue
            ids = lesson_ids(formation.curriculum)
            for handle, status, fraction in rows:
                member = learners.get(handle) or db.query(Learner).filter(Learner.handle.ilike(handle)).first()
                if not member:
                    continue
                enr = db.query(FormationEnrollment).filter_by(
                    formation_id=formation.id, learner_id=member.id
                ).first()
                if not enr:
                    enr = FormationEnrollment(
                        formation_id=formation.id, learner_id=member.id,
                        invited_by=formation.trainer_name,
                    )
                    db.add(enr)
                enr.status = status
                n_done = round(len(ids) * fraction)
                done = {
                    c.lesson_id
                    for c in db.query(FormationLessonCompletion).filter_by(
                        learner_id=member.id, formation_id=formation.id
                    )
                }
                for lesson_id in ids[:n_done]:
                    if lesson_id not in done:
                        db.add(FormationLessonCompletion(
                            learner_id=member.id, formation_id=formation.id, lesson_id=lesson_id
                        ))
        db.flush()

        # ---- 6. A week of live sessions -------------------------------------
        monday = _next_monday(TODAY)
        db.query(FormationSession).filter(
            FormationSession.formation_id.in_([f.id for f in formations.values()])
        ).delete(synchronize_session=False)
        for day_offset, hhmm, title, s_title, s_desc, minutes, location, url in SESSIONS:
            formation = formations.get(title)
            if not formation:
                continue
            hour, minute = map(int, hhmm.split(":"))
            local = dt.datetime.combine(monday + dt.timedelta(days=day_offset), dt.time(hour, minute))
            db.add(FormationSession(
                formation_id=formation.id, title=s_title, description=s_desc,
                starts_at=(local - LOCAL_UTC_OFFSET).replace(tzinfo=dt.timezone.utc),
                duration_min=minutes, location=location, meeting_url=url,
            ))

        # ---- 7. Certifications: catalog, suggestions, earned wall --------------
        certs: dict[str, Certification] = {}
        for name, provider, level, url, desc in CERTIFICATIONS:
            cert = db.query(Certification).filter(Certification.name == name).first()
            if not cert:
                cert = Certification(
                    name=name, provider=provider, level=level, url=url, description=desc,
                    added_by_id=trainer.id, added_by_name=trainer.name or trainer.handle,
                )
                db.add(cert)
                db.flush()
            certs[name] = cert

        team_by_name = {t.name: t for t in db.query(Team).all()}
        for cert_name, team_name, suggester_handle, note in CERT_SUGGESTIONS:
            cert, team = certs.get(cert_name), team_by_name.get(team_name)
            suggester = learners.get(suggester_handle)
            if not (cert and team and suggester):
                continue
            if not db.query(CertificationSuggestion).filter_by(
                certification_id=cert.id, team_id=team.id
            ).first():
                db.add(CertificationSuggestion(
                    certification_id=cert.id, team_id=team.id,
                    suggested_by_id=suggester.id,
                    suggested_by_name=suggester.name or suggester.handle,
                    note=note,
                ))

        for handle, cert_name, free_title, issuer, days_ago, cred_url, expires_in in EARNED_CERTS:
            owner = learners.get(handle)
            if not owner:
                continue
            cert = certs.get(cert_name) if cert_name else None
            title = cert.name if cert else free_title
            if db.query(EarnedCertificate).filter_by(learner_id=owner.id, title=title).first():
                continue
            db.add(EarnedCertificate(
                learner_id=owner.id,
                certification_id=cert.id if cert else None,
                title=title,
                issuer=issuer or (cert.provider if cert else ""),
                obtained_on=TODAY - dt.timedelta(days=days_ago),
                expires_on=TODAY + dt.timedelta(days=expires_in) if expires_in is not None else None,
                credential_url=cred_url,
            ))

        db.commit()
        print("HR demo data seeded:")
        print(f"  people: {len(PEOPLE)} (+ existing mehdi/sofia reused)")
        for name, _, lead, manager, members in TEAMS:
            print(f"  team: {name} — lead {lead}, manager {manager}, {len(members)} members")
        print(f"  formations: {', '.join(formations)}")
        print(f"  sessions: {len(SESSIONS)} scheduled from {monday}")
        print(f"  certifications: {len(CERTIFICATIONS)} in catalog, "
              f"{len(CERT_SUGGESTIONS)} team suggestions, {len(EARNED_CERTS)} earned shares")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
