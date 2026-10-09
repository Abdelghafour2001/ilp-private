"""Seed the skills spine: role profiles, multi-source ratings, logged learning.

Makes three things demonstrable that are otherwise invisible on an empty DB:

* role profiles with expected levels, so `gap = target − level` is real;
* ratings from peers, managers and assessments, so a level shows provenance
  rather than being one person's opinion of themselves;
* self-reported learning, so the hours figure includes what happens off the
  platform.

Run inside the backend container:  python -m app.seed_skills_spine [--force]
"""

import datetime as dt
import sys

from app.db.session import SessionLocal
from app.models import (
    Learner,
    LearnerSkill,
    LearningRecord,
    LearningRecordSkill,
    Skill,
    SkillProfile,
    SkillProfileTarget,
    SkillRating,
    Team,
)

TODAY = dt.date.today()

# name, description, practice matcher, job_level matcher, {skill: target level}
PROFILES = [
    (
        "Data Analyst — Confirmé",
        "Autonome sur l'analyse : requêtes, qualité, restitution.",
        "Data & Analytics",
        "Confirmé",
        {"SQL": 4, "Data Quality": 4, "Power BI": 3, "Communication": 3},
    ),
    (
        "Data Analyst — Junior",
        "Sait produire une analyse simple avec accompagnement.",
        "Data & Analytics",
        "Junior",
        {"SQL": 3, "Data Quality": 2, "Power BI": 2},
    ),
    (
        "Data Engineer",
        "Construit et fiabilise les pipelines de données.",
        "Data Engineering",
        "",
        {"SQL": 4, "Data Engineering": 4, "dbt": 3, "Data Quality": 3},
    ),
    (
        "AI / GenAI",
        "Conçoit et évalue des solutions GenAI.",
        "AI & GenAI",
        "",
        {"Prompt Engineering": 4, "GenAI Literacy": 4, "Communication": 3},
    ),
    (
        "Manager",
        "Encadre une équipe et pilote la montée en compétences.",
        "Management",
        "",
        {"Communication": 4, "Project Management": 4, "GenAI Literacy": 2},
    ),
]

# subject handle -> [(skill, source, level, rater handle or None)]
RATINGS = [
    ("youssef.benali", "SQL", "manager", 4, "hicham.raji"),
    ("youssef.benali", "SQL", "peer", 4, "imane.zahraoui"),
    ("youssef.benali", "Data Quality", "peer", 3, "sara.amrani"),
    ("imane.zahraoui", "SQL", "assessment", 5, None),
    ("imane.zahraoui", "Data Engineering", "manager", 4, "hicham.raji"),
    ("sara.amrani", "SQL", "peer", 2, "youssef.benali"),
    ("sara.amrani", "Power BI", "manager", 2, "hicham.raji"),
    ("nadia.bouzid", "Prompt Engineering", "assessment", 4, None),
    ("nadia.bouzid", "GenAI Literacy", "peer", 4, "yasmine.alaoui"),
    ("omar.tazi", "Prompt Engineering", "manager", 2, "leila.senhaji"),
    ("yasmine.alaoui", "GenAI Literacy", "manager", 4, "leila.senhaji"),
]

# handle -> [(kind, title, minutes, provider, [skills])]
RECORDS = {
    "youssef.benali": [
        ("book", "Designing Data-Intensive Applications (ch. 1-4)", 300, "O'Reilly", ["Data Engineering"]),
        ("article", "A visual guide to SQL window functions", 35, "Blog", ["SQL"]),
        ("conference", "Devoxx Morocco — track Data", 420, "Devoxx", ["Data Engineering", "SQL"]),
    ],
    "imane.zahraoui": [
        ("podcast", "Data Engineering Podcast — data contracts", 55, "Spotify", ["Data Quality"]),
        ("on_the_job", "Migration du pipeline Airflow vers dbt", 480, "", ["dbt", "Data Engineering"]),
    ],
    "nadia.bouzid": [
        ("article", "Anthropic — prompt engineering overview", 45, "Anthropic", ["Prompt Engineering"]),
        ("video", "Andrej Karpathy — Intro to LLMs", 60, "YouTube", ["GenAI Literacy"]),
        ("mentoring", "Session de mentorat GenAI avec Rachid", 90, "", ["Prompt Engineering"]),
    ],
    "sara.amrani": [
        ("article", "Power BI — modélisation en étoile", 40, "Microsoft Learn", ["Power BI"]),
    ],
    "yasmine.alaoui": [
        ("book", "Storytelling with Data", 240, "Wiley", ["Communication"]),
        ("on_the_job", "Atelier de cadrage GenAI avec le métier", 180, "", ["GenAI Literacy"]),
    ],
}


def _seed_profiles(db, skills) -> int:
    n = 0
    for name, desc, practice, job_level, targets in PROFILES:
        profile = db.query(SkillProfile).filter(SkillProfile.name == name).first()
        if not profile:
            profile = SkillProfile(name=name)
            db.add(profile)
        profile.description = desc
        profile.practice = practice
        profile.job_level = job_level
        db.flush()

        db.query(SkillProfileTarget).filter_by(profile_id=profile.id).delete()
        for skill_name, level in targets.items():
            skill = skills.get(skill_name)
            if skill:
                db.add(
                    SkillProfileTarget(
                        profile_id=profile.id, skill_id=skill.id, target_level=level
                    )
                )
        n += 1
    return n


def _seed_ratings(db, skills, people) -> int:
    n = 0
    for handle, skill_name, source, level, rater_handle in RATINGS:
        subject, skill = people.get(handle), skills.get(skill_name)
        if not subject or not skill:
            continue
        rater = people.get(rater_handle) if rater_handle else None
        row = (
            db.query(SkillRating)
            .filter_by(
                learner_id=subject.id,
                skill_id=skill.id,
                source=source,
                rater_id=rater.id if rater else None,
            )
            .first()
        )
        if not row:
            row = SkillRating(
                learner_id=subject.id,
                skill_id=skill.id,
                source=source,
                rater_id=rater.id if rater else None,
            )
            db.add(row)
        row.level = level
        row.rater_name = (rater.name or rater.handle) if rater else "assessment"
        # A self-rating deliberately a notch below the manager's, so the demo
        # shows provenance mattering rather than every source agreeing.
        ls = db.query(LearnerSkill).filter_by(learner_id=subject.id, skill_id=skill.id).first()
        if not ls:
            db.add(LearnerSkill(learner_id=subject.id, skill_id=skill.id, level=max(1, level - 1)))
        n += 1
    return n


def _seed_records(db, skills, people) -> tuple[int, int]:
    records = verified = 0
    for handle, entries in RECORDS.items():
        learner = people.get(handle)
        if not learner:
            continue
        team = db.get(Team, learner.team_id) if learner.team_id else None
        manager = db.get(Learner, team.manager_id) if team and team.manager_id else None

        for index, (kind, title, minutes, provider, skill_names) in enumerate(entries):
            row = (
                db.query(LearningRecord)
                .filter_by(learner_id=learner.id, title=title)
                .first()
            )
            if not row:
                row = LearningRecord(learner_id=learner.id, title=title)
                db.add(row)
            row.kind = kind
            row.minutes = minutes
            row.provider = provider
            row.completed_on = TODAY - dt.timedelta(days=3 * index + 2)
            # Verify roughly every other record, so the UI shows both states.
            if manager and index % 2 == 0:
                row.verified_by_id = manager.id
                row.verified_by_name = manager.name or manager.handle
                verified += 1
            db.flush()

            db.query(LearningRecordSkill).filter_by(record_id=row.id).delete()
            for skill_name in skill_names:
                skill = skills.get(skill_name)
                if skill:
                    db.add(LearningRecordSkill(record_id=row.id, skill_id=skill.id))
            records += 1
    return records, verified


def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        if db.query(SkillProfile).first() and not force:
            print("Skills spine already seeded — use --force to re-apply.")
            return

        skills = {s.name: s for s in db.query(Skill).all()}
        people = {l.handle: l for l in db.query(Learner).all()}
        if not skills:
            print("No skills in the catalog — run app.seed_skills_pathways first.")
            return

        profiles = _seed_profiles(db, skills)
        ratings = _seed_ratings(db, skills, people)
        records, verified = _seed_records(db, skills, people)
        db.commit()

        print("Skills spine seeded:")
        print(f"  role profiles with targets: {profiles}")
        print(f"  peer/manager/assessment ratings: {ratings}")
        print(f"  self-reported learning records: {records} ({verified} verified)")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
