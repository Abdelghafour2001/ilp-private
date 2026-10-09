"""Seed the CR features so each one is visible in the demo.

Covers, in order:

* internal vs external trainings, and external (Coursera/Udemy) courses, so the
  "type de programme" KPI has both sides;
* client-required certifications with a validity period, which is what drives
  the renewal reminders;
* a mandatory pathway with required/optional steps and a milestone that gates
  the rest of the journey;
* open sessions ("for ALL") with a capacity, a registration deadline and a
  register already taken, so the présence KPI is non-empty;
* a pre/post assessment pair on one training, with real scores, so the gain
  report has something to show.

Run inside the backend container:

    python -m app.seed_cr_features [--force]

Idempotent: re-running updates the same rows instead of duplicating them.
"""

import datetime as dt
import sys

from app.db.session import SessionLocal
from app.models import (
    Certification,
    Course,
    EarnedCertificate,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    FormationSession,
    Learner,
    Pathway,
    PathwayStep,
    SessionRegistration,
)

TODAY = dt.date.today()
NOW = dt.datetime.now(dt.timezone.utc)

# --- external programs ------------------------------------------------------
# training title -> provider (marks it as bought-in rather than built in-house)
EXTERNAL_TRAININGS = {
    "Project Management Essentials": "Cegos",
    "UX Fundamentals for Non-Designers": "Interaction Design Foundation",
}

# In-app courses fronted by a real video, so cards show a thumbnail instead of
# a wall of identical emoji. These are public, well-known talks/tutorials.
# title, emoji, summary, YouTube URL, lesson title
VIDEO_COURSES = [
    (
        "SQL en 1 heure — les fondamentaux",
        "🗃️",
        "Les requêtes qui couvrent 90 % du travail quotidien : SELECT, JOIN, GROUP BY.",
        "https://www.youtube.com/watch?v=7S_tz1z_5bA",
        "Cours vidéo : SQL pour débutants",
    ),
    (
        "Comprendre les LLM",
        "🤖",
        "Ce qu'un grand modèle de langage fait réellement, expliqué sans mathématiques.",
        "https://www.youtube.com/watch?v=zjkBMFhNj_g",
        "Cours vidéo : introduction aux LLM",
    ),
    (
        "Git au quotidien",
        "🌿",
        "Branches, merges et resets — le modèle mental qui évite les catastrophes.",
        "https://www.youtube.com/watch?v=RGOj5yH7evk",
        "Cours vidéo : Git & GitHub",
    ),
]

# title, provider, url, cost (MAD), summary
EXTERNAL_COURSES = [
    (
        "Google Data Analytics",
        "Coursera",
        "https://www.coursera.org/professional-certificates/google-data-analytics",
        400,
        "Parcours Coursera : SQL, tableurs, visualisation et nettoyage de données.",
    ),
    (
        "Microsoft Power BI Data Analyst",
        "Coursera",
        "https://www.coursera.org/professional-certificates/microsoft-power-bi-data-analyst",
        400,
        "Modélisation, DAX et publication de rapports Power BI.",
    ),
    (
        "Machine Learning Specialization",
        "Coursera",
        "https://www.coursera.org/specializations/machine-learning-introduction",
        600,
        "Les fondamentaux du ML supervisé et non supervisé.",
    ),
]

# --- certifications required by clients -------------------------------------
# certification name fragment -> (client, validity in months)
CLIENT_CERTS = {
    "DP-900": ("OCP Group", 24),
    "Databricks": ("Managem Mining Ops", 24),
    "AWS": ("OCP Group", 36),
}


def _seed_video_courses(db) -> int:
    """In-app courses whose first lesson is a real video — the cover is derived
    from it, so no artwork has to be uploaded by hand."""
    n = 0
    for title, emoji, summary, url, lesson_title in VIDEO_COURSES:
        course = db.query(Course).filter(Course.title == title).first()
        if not course:
            course = Course(title=title, author="rachid.berrada")
            db.add(course)
        course.emoji = emoji
        course.summary = summary
        course.level = "beginner"
        course.status = "published"
        course.curriculum = {
            "sections": [
                {
                    "title": "Vidéo",
                    "lessons": [
                        {
                            "id": "v1",
                            "title": lesson_title,
                            "type": "video",
                            "video_url": url,
                            "body_md": "",
                        }
                    ],
                }
            ]
        }
        n += 1
    return n


def _seed_external_programs(db) -> tuple[int, int]:
    trainings = 0
    for title, provider in EXTERNAL_TRAININGS.items():
        f = db.query(Formation).filter(Formation.title == title).first()
        if f:
            f.source, f.provider = "external", provider
            trainings += 1

    courses = 0
    for title, provider, url, cost, summary in EXTERNAL_COURSES:
        c = db.query(Course).filter(Course.title == title).first()
        if not c:
            c = Course(title=title, emoji="🎓", author=provider)
            db.add(c)
        c.summary = summary
        c.provider = provider
        c.external_url = url
        c.cost = cost
        c.status = "published"
        courses += 1
    return trainings, courses


def _seed_client_certifications(db) -> int:
    n = 0
    for fragment, (client, months) in CLIENT_CERTS.items():
        cert = db.query(Certification).filter(Certification.name.ilike(f"%{fragment}%")).first()
        if not cert:
            continue
        cert.client_required = True
        cert.client_name = client
        cert.validity_months = months
        n += 1

    # Give one holder a certificate that lapses soon, so the renewal view and
    # the reminder job both have a live case to show.
    cert = db.query(Certification).filter(Certification.name.ilike("%DP-900%")).first()
    holder = db.query(Learner).filter(Learner.handle == "imane.zahraoui").first()
    if cert and holder:
        earned = (
            db.query(EarnedCertificate)
            .filter_by(learner_id=holder.id, certification_id=cert.id)
            .first()
        )
        if not earned:
            earned = EarnedCertificate(learner_id=holder.id, certification_id=cert.id)
            db.add(earned)
        earned.title = cert.name
        earned.issuer = cert.provider
        earned.obtained_on = TODAY - dt.timedelta(days=700)
        earned.expires_on = TODAY + dt.timedelta(days=25)  # inside the 60-day window
        earned.last_reminder_days = None
    return n


def _seed_gated_pathway(db) -> str | None:
    """Turn the onboarding pathway into a gated, mandatory journey."""
    pathway = db.query(Pathway).filter(Pathway.title.ilike("%Data Analyst Onboarding%")).first()
    if not pathway:
        return None
    pathway.mandatory = True
    pathway.summary = (
        "Parcours obligatoire des 60 premiers jours : tester la donnée, maîtriser "
        "les outils analytiques, puis certifier les fondamentaux."
    )
    db.query(PathwayStep).filter_by(pathway_id=pathway.id).delete()

    def find(kind, fragment):
        model = {"formation": Formation, "course": Course, "certification": Certification}[kind]
        column = Certification.name if kind == "certification" else model.title
        return db.query(model).filter(column.ilike(f"%{fragment}%")).first()

    # (kind, fragment, note, required, milestone)
    plan = [
        ("formation", "Data Quality Fundamentals",
         "Commence ici — le socle interne.", True, False),
        ("formation", "Effective Communication",
         "Optionnel : utile pour restituer tes analyses.", False, False),
        ("course", "Google Data Analytics",
         "Jalon : termine au moins les modules SQL et tableurs.", True, True),
        ("course", "Microsoft Power BI Data Analyst",
         "Optionnel : si ton équipe travaille sur Power BI.", False, False),
        ("certification", "DP-900",
         "Passe l'examen une fois le jalon franchi.", True, False),
    ]

    position = 0
    for kind, fragment, note, required, milestone in plan:
        entity = find(kind, fragment)
        if not entity:
            continue
        db.add(PathwayStep(
            pathway_id=pathway.id, position=position, entity_type=kind,
            entity_id=entity.id, note=note, required=required, milestone=milestone,
        ))
        position += 1
    return f"{pathway.title} ({position} steps)"


def _seed_open_sessions(db) -> int:
    """Two open sessions: one upcoming with a waitlist, one past with a register."""
    organiser = db.query(Learner).filter(Learner.handle == "khalid.ou").first()
    trainer = db.query(Learner).filter(Learner.handle == "rachid.berrada").first()
    everyone = db.query(Learner).filter(Learner.role == "user").limit(8).all()
    if not everyone:
        return 0

    specs = [
        {
            "title": "Sensibilisation GenAI — session ouverte",
            "description": "Une heure pour comprendre ce que la GenAI change dans nos métiers.",
            "starts_at": NOW + dt.timedelta(days=6),
            "duration_min": 60,
            "location": "Casablanca — Auditorium",
            "capacity": 4,
            "deadline": NOW + dt.timedelta(days=4),
            "theme": "GenAI",
            "past": False,
        },
        {
            "title": "Atelier Data Quality — session ouverte",
            "description": "Atelier pratique : écrire ses premiers contrôles qualité.",
            "starts_at": NOW - dt.timedelta(days=10),
            "duration_min": 180,
            "location": "Marrakech — Salle Ourika",
            "capacity": 6,
            "deadline": NOW - dt.timedelta(days=13),
            "theme": "Data Quality",
            "past": True,
        },
    ]

    created = 0
    for spec in specs:
        session = (
            db.query(FormationSession).filter(FormationSession.title == spec["title"]).first()
        )
        if not session:
            session = FormationSession(title=spec["title"])
            db.add(session)
        session.formation_id = None
        session.description = spec["description"]
        session.starts_at = spec["starts_at"]
        session.duration_min = spec["duration_min"]
        session.location = spec["location"]
        session.open_to_all = True
        session.capacity = spec["capacity"]
        session.registration_deadline = spec["deadline"]
        session.theme = spec["theme"]
        session.trainer_id = trainer.id if trainer else None
        session.trainer_name = (trainer.name or trainer.handle) if trainer else ""
        session.created_by_id = organiser.id if organiser else None
        db.flush()

        db.query(SessionRegistration).filter_by(session_id=session.id).delete()
        for index, learner in enumerate(everyone):
            status = "registered" if index < spec["capacity"] else "waitlisted"
            attended = None
            if spec["past"] and status == "registered":
                # A realistic register: most turn up, one doesn't.
                attended = index != 2
            db.add(SessionRegistration(
                session_id=session.id,
                learner_id=learner.id,
                status=status,
                attended=attended,
                marked_by=(trainer.name or trainer.handle) if (spec["past"] and trainer) else "",
            ))
        created += 1
    return created


def _seed_pre_post_assessment(db) -> str | None:
    """Bracket one training with an entry and an exit evaluation."""
    formation = (
        db.query(Formation).filter(Formation.title == "Data Quality Fundamentals").first()
    )
    if not formation:
        return None

    curriculum = dict(formation.curriculum or {})
    modules = list(curriculum.get("modules") or [])
    if not modules:
        return None

    questions = [
        {
            "question": "Un contrôle de fraîcheur (freshness) vérifie…",
            "options": [
                "que la table a été mise à jour récemment",
                "que les colonnes ont le bon type",
                "que la table n'a pas de doublons",
            ],
            "answer_index": 0,
            "explanation": "La fraîcheur mesure l'écart entre maintenant et la dernière mise à jour.",
        },
        {
            "question": "Quel contrôle détecte une clé primaire dupliquée ?",
            "options": ["not_null", "unique", "range"],
            "answer_index": 1,
            "explanation": "`unique` échoue dès qu'une valeur apparaît deux fois.",
        },
        {
            "question": "Une suite de contrôles sert à…",
            "options": [
                "grouper des contrôles exécutés ensemble",
                "stocker les résultats historiques",
                "définir une connexion",
            ],
            "answer_index": 0,
            "explanation": "Une suite regroupe les contrôles qui tournent en même temps.",
        },
    ]

    def quiz(lesson_id: str, title: str, role: str) -> dict:
        return {
            "id": lesson_id,
            "title": title,
            "type": "quiz",
            "assessment": role,
            "body_md": (
                "Évaluation d'entrée — elle mesure ton niveau de départ, "
                "réponds sans chercher."
                if role == "pre"
                else "Évaluation de sortie — mêmes questions, pour mesurer la progression."
            ),
            "xp": 10 if role == "pre" else 25,
            "duration_min": 10,
            "questions": questions,
        }

    # Drop any previous pass so re-running doesn't stack duplicate evaluations.
    for module in modules:
        module["lessons"] = [
            l for l in module.get("lessons", []) if not l.get("assessment")
        ]
    modules = [m for m in modules if m["lessons"]]

    modules.insert(0, {
        "title": "Évaluation d'entrée",
        "lessons": [quiz("dq-pre", "Test de positionnement", "pre")],
    })
    modules.append({
        "title": "Évaluation de sortie",
        "lessons": [quiz("dq-post", "Test final", "post")],
    })
    curriculum["modules"] = modules
    formation.curriculum = curriculum

    # Scores for the trainees already enrolled: everyone improves, by varying
    # amounts, which is what makes the gain column worth looking at.
    scores = [(40, 85), (55, 90), (30, 70), (65, 95), (50, 75)]
    enrolled = (
        db.query(FormationEnrollment)
        .filter(
            FormationEnrollment.formation_id == formation.id,
            FormationEnrollment.status.in_(("active", "completed")),
        )
        .limit(len(scores))
        .all()
    )
    for enrollment, (pre, post) in zip(enrolled, scores):
        for lesson_id, score in (("dq-pre", pre), ("dq-post", post)):
            row = (
                db.query(FormationLessonCompletion)
                .filter_by(
                    learner_id=enrollment.learner_id,
                    formation_id=formation.id,
                    lesson_id=lesson_id,
                )
                .first()
            )
            if not row:
                row = FormationLessonCompletion(
                    learner_id=enrollment.learner_id,
                    formation_id=formation.id,
                    lesson_id=lesson_id,
                )
                db.add(row)
            row.data = {"score": score}
    return f"{formation.title} ({len(enrolled)} trainees measured)"


def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        already = db.query(Certification).filter(Certification.client_required.is_(True)).first()
        if already and not force:
            print("CR features already seeded — use --force to re-apply.")
            return

        trainings, courses = _seed_external_programs(db)
        videos = _seed_video_courses(db)
        db.flush()
        certs = _seed_client_certifications(db)
        pathway = _seed_gated_pathway(db)
        sessions = _seed_open_sessions(db)
        assessment = _seed_pre_post_assessment(db)
        db.commit()

        print("CR features seeded:")
        print(f"  external programs: {trainings} trainings, {courses} Coursera courses")
        print(f"  video-backed courses (derived covers): {videos}")
        print(f"  client-required certifications: {certs}")
        print(f"  gated pathway: {pathway or 'not found'}")
        print(f"  open sessions with registration: {sessions}")
        print(f"  pre/post assessment: {assessment or 'not found'}")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
