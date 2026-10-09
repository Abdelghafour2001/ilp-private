"""Open the first question to every business unit, not just one.

Step 1 of onboarding asked "what describes you best?" and offered Data Analyst,
Data Engineer and AI/GenAI. That was right while the platform served one
practice. It is wrong now: a maintenance engineer in Automation or an HR
colleague reads those five options, recognises none of them, and learns in the
first thirty seconds that this tool was not built for them.

The replacement asks the same question in terms every unit shares — what kind
of work they do — and keeps the data and AI options for the people who do want
them.

Keys are stable: past answers keep their meaning, so nobody's onboarding
history is orphaned. The three original roles are kept and re-labelled rather
than retired, because learners already carry those keys.

L&D can edit all of this at /admin/onboarding; this script only moves the
default somewhere sensible for a company-wide rollout.

    podman exec -i <backend> python - < app/ops_generic_onboarding.py
"""

from __future__ import annotations

from app.db.session import SessionLocal
from app.models import OnboardingRole

# key -> (emoji, French, English). Order is the order they are shown.
ROLES: list[tuple[str, str, str, str]] = [
    ("business", "💼", "Métier / opérations", "Business / operations"),
    ("manager", "🧭", "Encadrement d'équipe", "Managing a team"),
    ("engineering", "🔧", "Technique / ingénierie", "Technical / engineering"),
    ("data_analyst", "📊", "Données & reporting", "Data & reporting"),
    ("ai", "🤖", "IA & innovation", "AI & innovation"),
    ("support", "🤝", "Fonctions support (RH, finance, achats)", "Support functions (HR, finance, procurement)"),
    ("other", "🌱", "Autre / je découvre", "Something else / just exploring"),
]

# Kept for the answers already recorded against them, but no longer offered.
RETIRE = ["data_engineer"]


def main() -> None:
    db = SessionLocal()

    for position, (key, emoji, fr, en) in enumerate(ROLES, start=1):
        role = db.query(OnboardingRole).filter(OnboardingRole.key == key).first()
        if not role:
            role = OnboardingRole(key=key)
            db.add(role)
        role.emoji = emoji
        role.label_fr = fr
        role.label_en = en
        role.sort_order = position
        role.active = True

    for key in RETIRE:
        role = db.query(OnboardingRole).filter(OnboardingRole.key == key).first()
        if role:
            role.active = False

    db.commit()

    print("First onboarding question now reads:\n")
    for role in (
        db.query(OnboardingRole)
        .filter(OnboardingRole.active.is_(True))
        .order_by(OnboardingRole.sort_order)
        .all()
    ):
        print(f"  {role.emoji}  {role.label_en}")
    retired = db.query(OnboardingRole).filter(OnboardingRole.active.is_(False)).count()
    print(f"\n{retired} retired (kept, so past answers still mean something).")
    print("L&D can change any of this at /admin/onboarding.")
    db.close()


if __name__ == "__main__":
    main()
