"""Seed a fresh dev database in one shot: demo content, formations, skills,
the HR demo cast, org profiles — and one guaranteed login per role so every
teammate works with the same accounts.

Run inside the backend container (after migrations):

    python -m app.seed_all           # each stage skips itself if already seeded
    python -m app.seed_all --force   # re-apply the stages that support it

In Docker:  docker compose exec backend python -m app.seed_all
Or set AUTO_SEED=1 on the backend service to run it automatically at startup.
"""

from __future__ import annotations

import sys

from app.db.session import SessionLocal
from app.models import Learner

# One canonical account per role — log in with the handle, no password.
# (handle, display name, role)
ACCOUNTS = [
    ("admin", "Admin Demo", "admin"),
    ("aicha.abouaid", "Aicha Abouaid", "hr_lead"),
    ("khalid.ou", "Khalid Ou", "hr"),
    ("hicham.raji", "Hicham Raji", "manager"),
    ("salma.idrissi", "Salma Idrissi", "trainer"),
    ("rachid.berrada", "Rachid Berrada", "trainer"),
    ("omar.elouafi", "Omar El Ouafi", "manager"),
    ("abdelghafour.lahrache", "Abdelghafour Lahrache", "trainer"),
    ("salma.elbarbori", "Salma El Barbori", "user"),
    ("youssef.benali", "Youssef Benali", "user"),
]


def ensure_role_accounts() -> None:
    db = SessionLocal()
    try:
        for handle, name, role in ACCOUNTS:
            learner = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
            if not learner:
                learner = Learner(handle=handle)
                db.add(learner)
            learner.name = learner.name or name
            learner.email = learner.email or f"{handle}@aida.local"
            learner.role = role
            learner.onboarded = True  # skip the first-connection assessment wall
        db.commit()
    finally:
        db.close()


def main() -> None:
    force = "--force" in sys.argv

    from app import (
        seed_cr_features,
        seed_demo,
        seed_demo_hr,
        seed_formations,
        seed_governance,
        seed_org_profiles,
        seed_skills_pathways,
        seed_skills_spine,
        seed_soft_skills,
    )

    stages = [
        ("demo content (learners, courses, challenges, assets)", seed_demo.main),
        ("formations", lambda: seed_formations.seed(force=force)),
        ("soft-skills formations", lambda: seed_soft_skills.seed(force=force)),
        # The HR cast creates the certifications and the remaining formations,
        # so it has to run BEFORE pathways — a pathway step silently drops when
        # the content it points at doesn't exist yet.
        ("HR demo cast (teams, roles, sessions)", lambda: seed_demo_hr.seed(force=force)),
        ("skills, pathways & goals", lambda: seed_skills_pathways.seed(force=force)),
        ("org profiles, costs & ratings", seed_org_profiles.seed),
        ("CR features (gating, open sessions, client certs)", lambda: seed_cr_features.seed(force=force)),
        ("skills spine (role targets, ratings, logged learning)", lambda: seed_skills_spine.seed(force=force)),
        ("governance cast (HR lead, manager queue, approvals)", lambda: seed_governance.seed(force=force)),
        ("role accounts", ensure_role_accounts),
    ]

    failures: list[str] = []
    for label, run in stages:
        print(f"\n==> Seeding {label}")
        try:
            run()
        except Exception as exc:  # keep going: stages are independent
            failures.append(label)
            print(f"    FAILED: {exc!r}")

    print("\n" + "=" * 56)
    if failures:
        print("Some stages failed: " + ", ".join(failures))
    else:
        print("All stages done. Log in with one of these handles:")
        print()
        for handle, _name, role in ACCOUNTS:
            print(f"    {handle:<18} {role}")
    print("=" * 56)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
