"""Make the compliance rules visible in the demo.

Three behaviours that only mean something when you can see them working:

* a **mandatory** training, badged as such on its own card rather than only
  inside a pathway,
* a **gating entry assessment** that blocks the rest of the programme until it
  is taken, so the entry score is a real baseline instead of a self-selected
  one,
* **feedback as the last step**, so a programme that asks for a review is not
  reported complete until it gets one.

Run inside the backend container:  python -m app.seed_compliance [--force]
"""

import sys

from app.db.session import SessionLocal
from app.models import Course, Formation

ENTRY_QUIZ = {
    "id": "entry-assessment",
    "title": "Évaluation d'entrée",
    "type": "quiz",
    "assessment": "pre",
    # The two flags that make it a gate rather than a suggestion.
    "gating": True,
    # 0 = any submission counts. A baseline measures, it does not filter: a
    # pass mark here would only stop the people the training exists for.
    "pass_score": 0,
    "xp": 20,
    "duration_min": 10,
    "body_md": (
        "Avant de commencer, quelques questions pour situer votre niveau de départ. "
        "Il n'y a pas de note éliminatoire — l'objectif est de mesurer votre progression "
        "à la fin."
    ),
    "questions": [
        {
            "prompt": "Qu'est-ce qu'un prompt système ?",
            "options": [
                "Une instruction cachée qui cadre le comportement du modèle",
                "La question posée par l'utilisateur",
                "Un message d'erreur",
            ],
            "answer": 0,
        },
        {
            "prompt": "Le few-shot prompting consiste à…",
            "options": [
                "Poser la question plusieurs fois",
                "Donner des exemples dans le prompt",
                "Réduire la température",
            ],
            "answer": 1,
        },
        {
            "prompt": "Une hallucination est…",
            "options": [
                "Une réponse plausible mais fausse",
                "Un dépassement de quota",
                "Une réponse trop longue",
            ],
            "answer": 0,
        },
    ],
}

# title fragment -> (mandatory, require_feedback, add a gating entry quiz)
RULES = [
    ("Prompt Engineering", True, True, True),
    ("Data Quality", True, False, False),
    ("GenAI for Business", False, True, False),
]


def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        touched = []
        for fragment, mandatory, require_feedback, gate in RULES:
            formation = (
                db.query(Formation).filter(Formation.title.ilike(f"%{fragment}%")).first()
            )
            if not formation:
                continue
            if formation.mandatory == mandatory and not force:
                continue

            formation.mandatory = mandatory
            formation.require_feedback = require_feedback

            if gate:
                curriculum = dict(formation.curriculum or {})
                modules = list(curriculum.get("modules") or [])
                already = any(
                    lesson.get("id") == ENTRY_QUIZ["id"]
                    for module in modules
                    for lesson in (module.get("lessons") or [])
                )
                if not already:
                    # The gate goes at the very front of the very first module.
                    # An entry assessment sitting mid-curriculum measures
                    # nothing, because by then the learner has already learnt.
                    if modules:
                        first = dict(modules[0])
                        first["lessons"] = [ENTRY_QUIZ] + list(first.get("lessons") or [])
                        modules[0] = first
                    else:
                        modules = [{"title": "Démarrage", "lessons": [ENTRY_QUIZ]}]
                    curriculum["modules"] = modules
                    formation.curriculum = curriculum

            touched.append((formation.title, mandatory, require_feedback, gate))

        # One mandatory course too, so the badge is not only a formation thing.
        course = (
            db.query(Course)
            .filter(Course.title.ilike("%Sécurité%"))
            .first()
        ) or db.query(Course).order_by(Course.id).first()
        if course:
            course.mandatory = True
            course.require_feedback = True

        db.commit()
        print("Compliance rules applied:")
        for title, mandatory, feedback, gate in touched:
            bits = []
            if mandatory:
                bits.append("obligatoire")
            if feedback:
                bits.append("feedback requis")
            if gate:
                bits.append("évaluation d'entrée bloquante")
            print(f"  {title} — {', '.join(bits) or 'aucune règle'}")
        if course:
            print(f"  {course.title} (cours) — obligatoire, feedback requis")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
