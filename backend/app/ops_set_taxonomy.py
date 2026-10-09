"""Reduce the organisation to the five real business units and their practices.

The 275 imported colleagues arrived carrying Coursera's own unit names — HCMS,
NGEA, Support F, Data & Digital Garage — none of which are this company's
organisation. Thirteen unit names existed, twelve of them meaningless here.

This registers the five real ones with their métiers, and moves everybody onto
them.

Two things are stated plainly rather than hidden:

* **AI & Data is real and is left alone.** Its head, HRBP, practices and team
  membership were set deliberately and are not touched.
* **Everyone else is placed at random.** Nobody knows which unit these people
  actually belong to, and inventing a plausible-looking mapping would be worse
  than an obviously arbitrary one — a random assignment is visibly demo data,
  a plausible one gets quoted in a meeting. The seed is fixed so a re-run
  produces the same org rather than reshuffling the company every time.

    podman exec -i <backend> python - < app/ops_set_taxonomy.py
"""

from __future__ import annotations

import random

from app.db.session import SessionLocal
from app.models import BuHeadAssignment, BusinessUnit, Learner, Practice, Team

# The organisation, as the client gave it.
TAXONOMY: dict[str, list[str]] = {
    "NGES": [
        "SAP S4HANA (Technico & Fonctionnel)",
        "EPM",
        "HCM",
        "WORKDAY",
        "Successfactors",
    ],
    "DOT": [
        "INFRASTRUCTURE & CLOUD",
        "CYBERSECURITY",
        "DEVOPS & AUTOMATION",
        "MANAGED SERVICES",
    ],
    "Automation": ["Instrumentation"],
    "Digital Forge": ["Low Code (Mendix)", "No Code (Creatio)"],
    "AI & Data": ["AI", "Data"],
}
CODES = {"NGES": "NGES", "DOT": "DOT", "Automation": "AUTO", "Digital Forge": "DF", "AI & Data": "AID"}

# Already set up by hand, with real names. Left exactly as it is.
KEEP = "AI & Data"


def main() -> None:
    db = SessionLocal()
    rng = random.Random(20260930)

    # --- the registry -------------------------------------------------------
    for position, (name, practices) in enumerate(TAXONOMY.items(), start=1):
        unit = db.query(BusinessUnit).filter(BusinessUnit.name == name).first()
        if not unit:
            unit = BusinessUnit(name=name, code=CODES[name], position=position)
            db.add(unit)
        unit.archived = False
        unit.position = position
        db.commit()
        db.refresh(unit)

        for index, practice_name in enumerate(practices, start=1):
            row = (
                db.query(Practice)
                .filter(Practice.bu_id == unit.id, Practice.name == practice_name)
                .first()
            )
            if not row:
                row = Practice(bu_id=unit.id, name=practice_name)
                db.add(row)
            row.position = index
            row.archived = False
        db.commit()

    # Anything not on the list is retired, not deleted: an archived unit keeps
    # whatever history already points at it.
    retired = (
        db.query(BusinessUnit)
        .filter(BusinessUnit.name.notin_(list(TAXONOMY)))
        .update({"archived": True}, synchronize_session=False)
    )
    db.commit()
    print(f"registry: {len(TAXONOMY)} units, {sum(len(v) for v in TAXONOMY.values())} practices, {retired} retired")

    # --- move the people ----------------------------------------------------
    others = [name for name in TAXONOMY if name != KEEP]
    moved = 0
    for learner in db.query(Learner).all():
        if learner.bu == KEEP:
            continue  # the real one, set up by hand
        unit = rng.choice(others)
        learner.bu = unit
        learner.practice = rng.choice(TAXONOMY[unit])
        moved += 1
    db.commit()
    print(f"people: {moved} placed at random across {', '.join(others)}")

    # --- somebody has to run each one --------------------------------------
    for name in others:
        members = db.query(Learner).filter(Learner.bu == name).all()
        if not members:
            continue
        head = rng.choice(members)
        head.role = "bu_head" if head.role in ("user", "trainer") else head.role
        row = db.query(BuHeadAssignment).filter(BuHeadAssignment.bu == name).first()
        if row:
            row.head_id = head.id
        else:
            db.add(BuHeadAssignment(bu=name, head_id=head.id))

        # One team per practice, so the chart has something under the head.
        for practice_name in TAXONOMY[name]:
            in_practice = [m for m in members if m.practice == practice_name and m.id != head.id]
            if not in_practice:
                continue
            manager = rng.choice(in_practice)
            manager.role = "manager" if manager.role in ("user", "trainer") else manager.role
            team = db.query(Team).filter(Team.name == practice_name).first()
            if not team:
                team = Team(name=practice_name)
                db.add(team)
            team.manager_id = manager.id
            team.lead_id = manager.id
            db.commit()
            db.refresh(team)
            for member in in_practice:
                member.team_id = team.id
            manager.team_id = team.id
        db.commit()
        print(f"  {name}: head {head.name or head.handle}, {len(members)} people")

    db.close()


if __name__ == "__main__":
    main()
