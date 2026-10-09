"""Install the company-wide skill catalogue, and wire it to onboarding.

Idempotent, and deliberately non-destructive:

* a skill that already exists keeps its id — and therefore every rating, every
  follower and every piece of content linked to it — while its domain and kind
  are corrected. "Project Management" sat under *Soft skills*; it moves to
  *Project & service delivery* as a hard skill without anybody losing their
  level on it.
* nothing is deleted. A skill not in the catalogue was added by L&D in the app,
  and the app is where it is removed.

    podman exec -i <backend> python - < app/ops_seed_skill_taxonomy.py
"""

from __future__ import annotations

from app.core import skill_taxonomy
from app.db.session import SessionLocal
from app.models import OnboardingRole, OnboardingRoleSkill, Skill


def main() -> None:
    db = SessionLocal()

    created = moved = unchanged = 0
    for name, domain, kind, description in skill_taxonomy.flat():
        skill = db.query(Skill).filter(Skill.name == name).first()
        if not skill:
            db.add(Skill(name=name, category=domain, kind=kind, description=description))
            created += 1
            continue
        if (skill.category, skill.kind) != (domain, kind):
            print(f"  {name}: {skill.category}/{skill.kind} -> {domain}/{kind}")
            skill.category, skill.kind = domain, kind
            moved += 1
        else:
            unchanged += 1
        # A description written in the app wins; an empty one is filled in.
        skill.description = skill.description or description
    db.commit()

    # --- what the first onboarding question preselects --------------------
    by_name = {s.name: s for s in db.query(Skill).all()}
    linked = missing = 0
    for key, names in skill_taxonomy.ROLE_SKILLS.items():
        role = db.query(OnboardingRole).filter(OnboardingRole.key == key).first()
        if not role:
            print(f"  no onboarding role '{key}' — skipped")
            continue
        for name in names:
            skill = by_name.get(name)
            if not skill:
                missing += 1
                continue
            exists = (
                db.query(OnboardingRoleSkill)
                .filter_by(role_id=role.id, skill_id=skill.id)
                .first()
            )
            if not exists:
                db.add(OnboardingRoleSkill(role_id=role.id, skill_id=skill.id))
                linked += 1
    db.commit()

    total = db.query(Skill).count()
    print(
        f"\nskills: {created} created, {moved} re-categorised, {unchanged} already right "
        f"({total} in the catalogue)"
    )
    print(f"onboarding: {linked} role/skill links added" + (f", {missing} names not found" if missing else ""))
    for kind, domains in skill_taxonomy.kinds().items():
        print(f"  {kind}: {len(domains)} domains")
    db.close()


if __name__ == "__main__":
    main()
