"""Reading and writing the first-connection wizard's content.

`ensure_seeded` exists so that neither a fresh install nor an upgrade arrives at
an empty wizard: the former hardcoded presets are the seed, written once. After
that the tables are authoritative and L&D owns them — a preset changing in a
later release must not quietly overwrite what they configured.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import OnboardingGoal, OnboardingRole, OnboardingRoleSkill, Skill

# The presets this feature started life as. Skills are named, not id'd: ids
# differ per install, names are the stable handle in the seed catalogue.
DEFAULT_ROLES: list[dict] = [
    {
        "key": "data_analyst",
        "label_fr": "Data Analyst / BI",
        "label_en": "Data Analyst / BI",
        "emoji": "📊",
        "skills": ["SQL", "Power BI", "Data Quality"],
    },
    {
        "key": "data_engineer",
        "label_fr": "Data Engineer",
        "label_en": "Data Engineer",
        "emoji": "🔧",
        "skills": ["SQL", "Data Engineering", "dbt", "Data Quality"],
    },
    {
        "key": "ai",
        "label_fr": "IA / GenAI",
        "label_en": "AI / GenAI",
        "emoji": "🤖",
        "skills": ["Prompt Engineering", "GenAI Literacy"],
    },
    {
        "key": "business",
        "label_fr": "Métier / Manager",
        "label_en": "Business / Manager",
        "emoji": "💼",
        "skills": ["GenAI Literacy", "Project Management", "Communication"],
    },
    {
        "key": "other",
        "label_fr": "Autre / Je découvre",
        "label_en": "Other / Just exploring",
        "emoji": "🧭",
        "skills": ["Communication", "GenAI Literacy"],
    },
]

DEFAULT_GOALS: list[dict] = [
    {"minutes": 15, "label_fr": "15 min — je découvre", "label_en": "15 min — dipping in"},
    {"minutes": 30, "label_fr": "30 min — bon rythme", "label_en": "30 min — steady pace"},
    {"minutes": 60, "label_fr": "1 h — motivé·e", "label_en": "1 h — committed"},
    {"minutes": 120, "label_fr": "2 h — à fond", "label_en": "2 h — all in"},
]


def ensure_seeded(db: Session) -> None:
    """Populate the wizard from the former presets, once, if it is empty.

    Each table is checked separately: an install that has roles configured but
    no goals (the goals table added later, say) should still get goals.
    """
    if not db.query(OnboardingRole.id).first():
        by_name = {s.name: s.id for s in db.query(Skill).all()}
        for order, preset in enumerate(DEFAULT_ROLES):
            role = OnboardingRole(
                key=preset["key"],
                label_fr=preset["label_fr"],
                label_en=preset["label_en"],
                emoji=preset["emoji"],
                sort_order=order,
            )
            db.add(role)
            db.flush()
            for name in preset["skills"]:
                # A skill the catalogue does not have yet is skipped rather
                # than created: inventing a skill from an onboarding preset
                # would put an untagged, contentless entry in the skill tree.
                if name in by_name:
                    db.add(OnboardingRoleSkill(role_id=role.id, skill_id=by_name[name]))

    if not db.query(OnboardingGoal.id).first():
        for order, preset in enumerate(DEFAULT_GOALS):
            db.add(OnboardingGoal(sort_order=order, **preset))

    db.commit()


def _label(fr: str, en: str, other: str) -> tuple[str, str]:
    """Neither language blank — an untranslated label shows the other one."""
    return fr or en or other, en or fr or other


def roles_payload(db: Session, *, include_inactive: bool = False) -> list[dict]:
    q = db.query(OnboardingRole)
    if not include_inactive:
        q = q.filter(OnboardingRole.active.is_(True))
    roles = q.order_by(OnboardingRole.sort_order, OnboardingRole.id).all()
    links = db.query(OnboardingRoleSkill).all()
    by_role: dict[int, list[int]] = {}
    for link in links:
        by_role.setdefault(link.role_id, []).append(link.skill_id)

    out = []
    for role in roles:
        label_fr, label_en = _label(role.label_fr, role.label_en, role.key)
        out.append(
            {
                "id": role.id,
                "key": role.key,
                "label_fr": label_fr,
                "label_en": label_en,
                "emoji": role.emoji,
                "sort_order": role.sort_order,
                "active": role.active,
                "skill_ids": sorted(by_role.get(role.id, [])),
            }
        )
    return out


def goals_payload(db: Session, *, include_inactive: bool = False) -> list[dict]:
    q = db.query(OnboardingGoal)
    if not include_inactive:
        q = q.filter(OnboardingGoal.active.is_(True))
    out = []
    for goal in q.order_by(OnboardingGoal.sort_order, OnboardingGoal.minutes).all():
        label_fr, label_en = _label(goal.label_fr, goal.label_en, f"{goal.minutes} min")
        out.append(
            {
                "id": goal.id,
                "minutes": goal.minutes,
                "label_fr": label_fr,
                "label_en": label_en,
                "sort_order": goal.sort_order,
                "active": goal.active,
            }
        )
    return out
