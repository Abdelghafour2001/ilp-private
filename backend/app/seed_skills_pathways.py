"""Seed the Degreed-style layer: skills catalog + content links + learner
self-ratings, two pathways with enrollments, and weekly learning goals.

Run inside the backend container:
    python -m app.seed_skills_pathways [--force]
"""

import datetime as dt
import sys

from app.db.session import SessionLocal
from app.models import (
    Certification,
    Course,
    Formation,
    Learner,
    LearnerSkill,
    Pathway,
    PathwayEnrollment,
    PathwayStep,
    Skill,
    SkillLink,
)

TODAY = dt.date.today()

# name, category, description
SKILLS = [
    ("SQL", "Data", "Query, join and aggregate data — the lingua franca of analytics."),
    ("Data Quality", "Data", "Profile, test and monitor data so people can trust it."),
    ("Data Engineering", "Data", "Pipelines, lakehouses and orchestration."),
    ("Power BI", "Data", "Dashboards and DAX for business reporting."),
    ("dbt", "Data", "Transformations, tests and docs as code."),
    ("Prompt Engineering", "AI", "Design prompts that hold up in production."),
    ("GenAI Literacy", "AI", "What LLMs do well, where they fail, how to pick use cases."),
    ("Project Management", "Soft skills", "Scope, plan, de-risk and deliver."),
    ("Communication", "Soft skills", "Clear messages, useful feedback, difficult conversations."),
    ("UX Design", "Soft skills", "See products through users' eyes and test with them."),
]

# skill -> [(finder_kind, title_fragment)]
LINKS = {
    "Prompt Engineering": [("formation", "Prompt Engineering for GenAI")],
    "GenAI Literacy": [("formation", "GenAI for Business Teams"), ("certification", "AI Fundamentals (AI-900)")],
    "Data Quality": [("formation", "Data Quality Fundamentals"), ("course", "Data Quality Crash Course")],
    "SQL": [
        ("course", "Google Data Analytics"),
        ("certification", "Data Fundamentals (DP-900)"),
        ("formation", "Data Quality Fundamentals"),  # checks are written in SQL
    ],
    "dbt": [("certification", "dbt Fundamentals")],
    "Data Engineering": [("certification", "Databricks Data Engineer"), ("certification", "AWS Certified Data Engineer")],
    "Project Management": [("formation", "Project Management Essentials"), ("course", "Foundations of Project Management")],
    "Communication": [("formation", "Effective Communication & Feedback")],
    "UX Design": [("formation", "UX Fundamentals for Non-Designers")],
}

# handle -> [(skill, level 0-5)]
RATINGS = {
    "abdelghafour.lahrache": [("SQL", 4), ("Prompt Engineering", 3), ("Data Quality", 2), ("GenAI Literacy", 3)],
    "salma.elbarbori": [("SQL", 4), ("Power BI", 4), ("Prompt Engineering", 3), ("UX Design", 2)],
    "salaheddine.elbaidoury": [("Power BI", 5), ("Project Management", 3), ("Data Quality", 3)],
    "mohannad.tazi": [("SQL", 2), ("Prompt Engineering", 1), ("GenAI Literacy", 2)],
    "imane.zahraoui": [("SQL", 5), ("dbt", 4), ("Data Quality", 4), ("Data Engineering", 3)],
    "youssef.benali": [("SQL", 4), ("Data Engineering", 3), ("Data Quality", 3)],
    "mehdi": [("SQL", 2), ("Data Quality", 2)],
    "sara.amrani": [("SQL", 1), ("Communication", 3)],
    "yasmine.alaoui": [("Prompt Engineering", 4), ("UX Design", 3), ("dbt", 2)],
    "nadia.bouzid": [("GenAI Literacy", 4), ("Communication", 4)],
    "omar.tazi": [("GenAI Literacy", 1)],
    "sofia": [("Data Quality", 1)],
}

GOALS = {  # weekly minutes
    "abdelghafour.lahrache": 60,
    "salma.elbarbori": 120,
    "mohannad.tazi": 30,
    "imane.zahraoui": 90,
    "youssef.benali": 60,
}

# title, emoji, summary, creator handle, steps [(kind, fragment, note)], enrollments
PATHWAYS = [
    (
        "Data Analyst Onboarding", "🧭",
        "The first 60 days: learn to test data, master the analytics toolkit, and certify the foundation.",
        "khalid.ou",
        [
            ("formation", "Data Quality Fundamentals", "Start here — our internal foundation."),
            ("course", "Google Data Analytics", "Coursera track: do at least the SQL and spreadsheets modules."),
            ("certification", "Data Fundamentals (DP-900)", "Book the exam once the two steps above feel easy."),
        ],
        [
            ("mohannad.tazi", "Omar El Ouafi", 30),
            ("sara.amrani", "Salma Idrissi", 45),
            ("abdelghafour.lahrache", "", None),
        ],
    ),
    (
        "GenAI Champion Track", "🤖",
        "From zero to team GenAI referent: business use cases, hands-on prompting, certified fundamentals.",
        "rachid.berrada",
        [
            ("formation", "GenAI for Business Teams", "The no-code big picture."),
            ("formation", "Prompt Engineering for GenAI", "Hands-on — pass all AI-graded challenges."),
            ("certification", "AI Fundamentals (AI-900)", "Certify it."),
        ],
        [
            ("nadia.bouzid", "Leila Senhaji", None),
            ("omar.tazi", "Leila Senhaji", 45),
        ],
    ),
]


def _find(db, kind: str, fragment: str):
    if kind == "formation":
        return db.query(Formation).filter(Formation.title.ilike(f"%{fragment}%")).first()
    if kind == "course":
        return db.query(Course).filter(Course.title.ilike(f"%{fragment}%")).first()
    return db.query(Certification).filter(Certification.name.ilike(f"%{fragment}%")).first()


def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        if db.query(Skill).first() and not force:
            print("Skills already seeded — use --force to re-apply.")
            return

        learners = {l.handle: l for l in db.query(Learner).all()}
        skills: dict[str, Skill] = {}
        for name, category, desc in SKILLS:
            s = db.query(Skill).filter(Skill.name.ilike(name)).first()
            if not s:
                s = Skill(name=name, category=category, description=desc)
                db.add(s)
                db.flush()
            skills[name] = s

        for skill_name, targets in LINKS.items():
            for kind, fragment in targets:
                entity = _find(db, kind, fragment)
                if not entity:
                    continue
                if not db.query(SkillLink).filter_by(
                    skill_id=skills[skill_name].id, entity_type=kind, entity_id=entity.id
                ).first():
                    db.add(SkillLink(skill_id=skills[skill_name].id, entity_type=kind, entity_id=entity.id))

        for handle, ratings in RATINGS.items():
            l = learners.get(handle)
            if not l:
                continue
            for skill_name, level in ratings:
                ls = db.query(LearnerSkill).filter_by(
                    learner_id=l.id, skill_id=skills[skill_name].id
                ).first()
                if not ls:
                    db.add(LearnerSkill(learner_id=l.id, skill_id=skills[skill_name].id, level=level))
                else:
                    ls.level = level

        for handle, minutes in GOALS.items():
            if handle in learners:
                learners[handle].weekly_goal_min = minutes

        for title, emoji, summary, creator_handle, steps, enrollments in PATHWAYS:
            p = db.query(Pathway).filter(Pathway.title == title).first()
            creator = learners.get(creator_handle)
            if not p:
                p = Pathway(
                    title=title, emoji=emoji, summary=summary,
                    created_by_id=creator.id if creator else None,
                    created_by_name=(creator.name or creator.handle) if creator else "admin",
                )
                db.add(p)
                db.flush()
                for i, (kind, fragment, note) in enumerate(steps):
                    entity = _find(db, kind, fragment)
                    if entity:
                        db.add(PathwayStep(
                            pathway_id=p.id, position=i,
                            entity_type=kind, entity_id=entity.id, note=note,
                        ))
            for handle, assigner, due_days in enrollments:
                l = learners.get(handle)
                if not l:
                    continue
                if not db.query(PathwayEnrollment).filter_by(pathway_id=p.id, learner_id=l.id).first():
                    db.add(PathwayEnrollment(
                        pathway_id=p.id, learner_id=l.id, assigned_by=assigner,
                        due_date=TODAY + dt.timedelta(days=due_days) if due_days else None,
                    ))

        db.commit()
        print(f"Seeded {len(SKILLS)} skills, links, {sum(len(r) for r in RATINGS.values())} ratings, "
              f"{len(PATHWAYS)} pathways, {len(GOALS)} weekly goals")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
