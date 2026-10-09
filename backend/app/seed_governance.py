"""Seed the governance cast: an HR lead, an HRBP perimeter, and a live team.

Gives every level of the ladder somebody real to log in as:

* **aicha.abouaid** — HR lead. Sees every HRBP, the BUs each covers, and the
  whole organisation. Does not administer the platform.
* **khalid.ou** — HRBP, perimeter set explicitly to two BUs.
* **maryam.bakh** — a second HRBP, so the chart shows more than one perimeter
  and the HR lead's view has something to compare. She covers Exploration only:
  Mining Operations is deliberately left with no HRBP, because a chart where
  everything is covered cannot demonstrate spotting the BU that is not.
* **mostapha.aibi** — head of the AI & Data BU, above both practice managers.
  Every training request raised in his unit reaches him after the N+1 has
  approved it, because the budget line is his rather than theirs.
* **omar.elouafi** — manager of the AI Factory practice, with a queue that
  already contains things to decide *and* things he has declined, because an
  empty board demonstrates nothing.
* **abdelghafour.lahrache** — trainer on that team.
* **salma.elbarbori** — collaborator on that team.

Run inside the backend container:  python -m app.seed_governance [--force]
"""

import datetime as dt
import sys

from app.db.session import SessionLocal
from app.models import (
    Asset,
    Course,
    Formation,
    HrBuAssignment,
    Learner,
    LearningRecord,
    LearningRecordSkill,
    Skill,
    Team,
    TrainingRequest,
)

NOW = dt.datetime.now(dt.timezone.utc)
TODAY = dt.date.today()

TEAM_NAME = "Digital & Data — Casablanca"

# handle, display name, role, bu, practice, location, job level, matricule
CAST = [
    ("aicha.abouaid", "Aicha Abouaid", "hr_lead",
     "Corporate", "Compétences & Formation", "Casablanca", "Director", "MGM-09710"),
    ("mostapha.aibi", "Mostapha Aibi", "bu_head",
     "AI & Data", "Direction AI & Data", "Casablanca", "Director", "MGM-09455"),
    ("maryam.bakh", "Maryam Bakhouch", "hr",
     "Exploration", "Ressources Humaines", "Marrakech", "Manager", "MGM-09824"),
    ("omar.elouafi", "Omar El Ouafi", "manager",
     "Digital & Data", "Data & Analytics", "Casablanca", "Manager", "MGM-09980"),
    ("abdelghafour.lahrache", "Abdelghafour Lahrache", "trainer",
     "Digital & Data", "Data & Analytics", "Casablanca", "Confirmé", "MGM-10241"),
    ("salma.elbarbori", "Salma El Barbori", "user",
     "Digital & Data", "Data & Analytics", "Casablanca", "Confirmé", "MGM-10333"),
]

# The HRBP's perimeter, now explicit rather than inferred from their own BU.
HR_PERIMETERS = {
    "khalid.ou": ["Digital & Data", "Corporate"],
    # One BU, not both uncovered ones: Mining Operations stays without an HRBP
    # on purpose, so the org chart still has a gap to surface.
    "maryam.bakh": ["Exploration"],
}

# requester handle, content title fragment, reason, outcome, decision note
REQUESTS = [
    ("salma.elbarbori", "Machine Learning Specialization",
     "Je reprends le scoring d'usure des convoyeurs au T4 et il me manque les bases ML.",
     "pending", ""),
    ("abdelghafour.lahrache", "Google Data Analytics",
     "Pour cadrer les demandes métier avant de construire les dashboards.",
     "pending", ""),
    ("salma.elbarbori", "Microsoft Power BI Data Analyst",
     "Monter en compétence sur la modélisation en étoile.",
     "approved", "OK, budget T4 validé. Prends le parcours avant fin novembre."),
    ("abdelghafour.lahrache", "Project Management Essentials",
     "J'aimerais suivre la formation gestion de projet en présentiel.",
     "declined",
     "Pas ce trimestre — la formation est à 15 000 MAD et le budget T4 est déjà "
     "engagé sur Power BI. On la reprogramme au T1, je la mets dans ton plan."),
    ("salma.elbarbori", "UX Fundamentals for Non-Designers",
     "Curiosité personnelle, pour mieux travailler avec l'équipe produit.",
     "declined",
     "Hors périmètre de ton poste pour l'instant. Priorité au ML et à Power BI ; "
     "on en rediscute à la revue de mi-année."),
]

# handle, kind, title, minutes, skills, outcome, note
RECORDS = [
    ("salma.elbarbori", "article", "Star schema vs snowflake — quand choisir", 45,
     ["Power BI"], "verified", "Bien vu, on l'a appliqué sur le rapport production."),
    ("salma.elbarbori", "book", "Storytelling with Data (ch. 1-5)", 240,
     ["Communication"], "pending", ""),
    ("abdelghafour.lahrache", "conference", "Meetup Data Casablanca — dbt en production", 180,
     ["Data Engineering"], "verified", ""),
    ("abdelghafour.lahrache", "on_the_job", "Refonte du modèle de données extraction", 480,
     ["SQL", "Data Quality"], "pending", ""),
    ("abdelghafour.lahrache", "video", "Série YouTube — 12 h de tutoriels Kubernetes", 720,
     [], "declined",
     "12 h sur une semaine ne colle pas avec le sprint qu'on a livré. "
     "Reformule en heures réelles et je revalide."),
]

# title, kind, summary, author handle, status, review note
ASSETS = [
    ("Notebook — détection d'anomalies capteurs", "notebook",
     "Prototype d'anomaly detection sur les données de vibration des broyeurs.",
     "abdelghafour.lahrache", "pending", ""),
    ("Template Power BI — reporting production", "code",
     "Modèle de rapport réutilisable, thème Managem et mesures DAX standard.",
     "salma.elbarbori", "approved", "Très utile, à partager avec les autres BU."),
    ("Export brut base RH (CSV)", "dataset",
     "Extraction complète pour analyse ad hoc.",
     "salma.elbarbori", "rejected",
     "Refusé : contient des matricules et des salaires en clair. "
     "Anonymise et repasse-le, ou garde-le dans l'espace RH restreint."),
]


def _upsert_person(db, handle, name, role, bu, practice, location, job_level, matricule):
    person = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
    if not person:
        person = Learner(handle=handle)
        db.add(person)
    person.name = name
    person.role = role
    person.bu, person.practice, person.location = bu, practice, location
    person.job_level, person.matricule = job_level, matricule
    person.email = person.email or f"{handle}@aida.local"
    person.onboarded = True
    return person


def _find_content(db, fragment):
    formation = db.query(Formation).filter(Formation.title.ilike(f"%{fragment}%")).first()
    if formation:
        return formation, "formation"
    course = db.query(Course).filter(Course.title.ilike(f"%{fragment}%")).first()
    return (course, "course") if course else (None, None)


def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        existing = db.query(Learner).filter(Learner.handle == "aicha.abouaid").first()
        if existing and not force:
            print("Governance cast already seeded — use --force to re-apply.")
            return

        people = {}
        for row in CAST:
            people[row[0]] = _upsert_person(db, *row)
        db.flush()

        # --- the team -------------------------------------------------------
        # Find it by its manager as well as its name: `seed_org_structure`
        # renames this team to the practice it really is, and looking only by
        # name would then create a second copy on every re-run.
        omar_id = people["omar.elouafi"].id
        team = (
            db.query(Team)
            .filter((Team.name == TEAM_NAME) | (Team.manager_id == omar_id))
            .first()
        )
        if not team:
            team = Team(name=TEAM_NAME)
            db.add(team)
        team.description = "Équipe Data & Analytics — pôle Digital & Data, Casablanca."
        team.manager_id = people["omar.elouafi"].id
        team.lead_id = people["abdelghafour.lahrache"].id
        db.flush()
        for handle in ("abdelghafour.lahrache", "salma.elbarbori"):
            people[handle].team_id = team.id

        # --- HRBP perimeters -------------------------------------------------
        perimeters = 0
        for handle, bus in HR_PERIMETERS.items():
            hrbp = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
            if not hrbp:
                continue
            db.query(HrBuAssignment).filter_by(hr_id=hrbp.id).delete()
            for bu in bus:
                db.add(HrBuAssignment(hr_id=hrbp.id, bu=bu, assigned_by_name="Aicha Abouaid"))
            perimeters += 1

        omar = people["omar.elouafi"]
        decider = omar.name

        # --- training requests ----------------------------------------------
        requests = 0
        for index, (handle, fragment, reason, status, note) in enumerate(REQUESTS):
            requester = people.get(handle)
            content, kind = _find_content(db, fragment)
            if not requester or not content:
                continue
            row = (
                db.query(TrainingRequest)
                .filter_by(learner_id=requester.id, title=content.title)
                .first()
            )
            if not row:
                row = TrainingRequest(learner_id=requester.id, title=content.title)
                db.add(row)
            row.formation_id = content.id if kind == "formation" else None
            row.course_id = content.id if kind == "course" else None
            row.cost = getattr(content, "cost", 0) or 0
            row.reason = reason
            row.status = status
            row.created_at = NOW - dt.timedelta(days=12 - index * 2)
            if status == "pending":
                row.decided_by_id, row.decided_by_name = None, ""
                row.decision_note, row.decided_at = "", None
            else:
                row.decided_by_id, row.decided_by_name = omar.id, decider
                row.decision_note = note
                row.decided_at = NOW - dt.timedelta(days=9 - index)
            requests += 1

        # --- logged learning awaiting (or refused) verification --------------
        skills = {s.name: s for s in db.query(Skill).all()}
        records = 0
        for index, (handle, kind, title, minutes, skill_names, status, note) in enumerate(RECORDS):
            learner = people.get(handle)
            if not learner:
                continue
            row = db.query(LearningRecord).filter_by(learner_id=learner.id, title=title).first()
            if not row:
                row = LearningRecord(learner_id=learner.id, title=title)
                db.add(row)
            row.kind, row.minutes = kind, minutes
            row.completed_on = TODAY - dt.timedelta(days=4 + index)
            row.created_at = NOW - dt.timedelta(days=4 + index)
            row.review_status, row.review_note = status, note
            if status == "pending":
                row.verified_by_id, row.verified_by_name, row.reviewed_at = None, "", None
            else:
                row.verified_by_id = omar.id if status == "verified" else None
                row.verified_by_name = decider
                row.reviewed_at = NOW - dt.timedelta(days=2 + index)
            db.flush()
            db.query(LearningRecordSkill).filter_by(record_id=row.id).delete()
            for name in skill_names:
                if name in skills:
                    db.add(LearningRecordSkill(record_id=row.id, skill_id=skills[name].id))
            records += 1

        # --- assets awaiting (or refused) review -----------------------------
        assets = 0
        for index, (title, kind, summary, handle, status, note) in enumerate(ASSETS):
            author = people.get(handle)
            if not author:
                continue
            row = db.query(Asset).filter_by(title=title).first()
            if not row:
                row = Asset(title=title)
                db.add(row)
            row.kind, row.summary = kind, summary
            row.author = author.name or author.handle
            row.learner_id = author.id
            row.status = status
            row.created_at = NOW - dt.timedelta(days=7 - index)
            if status == "pending":
                row.reviewed_by, row.review_note, row.reviewed_at = None, None, None
            else:
                row.reviewed_by, row.review_note = decider, note
                row.reviewed_at = NOW - dt.timedelta(days=4 - index)
            assets += 1

        db.commit()
        print("Governance cast seeded:")
        print(f"  people: {', '.join(f'{h} ({p.role})' for h, p in people.items())}")
        print(f"  team: {TEAM_NAME} — manager {omar.handle}, lead abdelghafour.lahrache")
        print(f"  HRBP perimeters set: {perimeters}")
        print(f"  training requests: {requests}  ({sum(1 for r in REQUESTS if r[3] == 'declined')} declined)")
        print(f"  logged learning to review: {records}")
        print(f"  assets to review: {assets}")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
