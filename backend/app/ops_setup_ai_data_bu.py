"""Stand up the AI & Data BU: its head, its HRBP, its two practices and teams.

The 275 imported colleagues arrived with the provider's own business units,
none of which exist in the governance registry — so everybody was invisible on
the org chart. This registers one real BU properly and populates it, as the
shape the others will be built to.

Two practices under one BU head, each with its own manager: AI and Data. Team
membership is what the platform actually reports on, so people are placed in
teams rather than only labelled with a practice.

Idempotent — safe to re-run.

    podman exec -i <backend> python - < app/ops_setup_ai_data_bu.py
"""

from __future__ import annotations

from app.db.session import SessionLocal
from app.models import BusinessUnit, BuHeadAssignment, HrBuAssignment, Learner, Team

BU = "AI & Data"

# handle -> (practice, role). The role is what the platform lets them do; the
# practice is where they sit.
PEOPLE = {
    # leadership
    "aicha.abouaid": ("Compétences & Formation", "hr_lead"),
    "mostapha.aibi": ("Direction AI & Data", "bu_head"),
    "omar.elouafi": ("AI", "manager"),
    "imane.chaoui": ("Data", "manager"),
    # AI practice
    "abdelghafour.lahrache": ("AI", "trainer"),
    "mohannad.tazi": ("AI", "user"),
    "hamza.atil": ("AI", "user"),
    "salma.elbarbori": ("AI", "user"),
    "mouad.guedad": ("AI", "user"),
    # Data practice
    "oussama.elhajjam": ("Data", "user"),
    "khawla.baddar": ("Data", "user"),
    "rania.belmir": ("Data", "user"),
}

TEAMS = {
    "AI Practice": ("omar.elouafi", [
        "abdelghafour.lahrache", "mohannad.tazi", "hamza.atil",
        "salma.elbarbori", "mouad.guedad",
    ]),
    "Data Practice": ("imane.chaoui", [
        "oussama.elhajjam", "khawla.baddar", "rania.belmir",
    ]),
}


def main() -> None:
    db = SessionLocal()
    by_handle = {l.handle: l for l in db.query(Learner).all()}

    missing = [h for h in PEOPLE if h not in by_handle]
    if missing:
        print("missing accounts, nothing done:", ", ".join(missing))
        return

    # --- the BU itself, in the registry the org chart reads ----------------
    unit = db.query(BusinessUnit).filter(BusinessUnit.name == BU).first()
    if not unit:
        unit = BusinessUnit(name=BU, code="AID", position=0)
        db.add(unit)
        db.commit()
    print(f"business unit: {unit.name} (#{unit.id})")

    # --- place the people ---------------------------------------------------
    for handle, (practice, role) in PEOPLE.items():
        person = by_handle[handle]
        # Aicha is L&D for the whole company, not a member of this BU.
        person.bu = person.bu if handle == "aicha.abouaid" else BU
        person.practice = practice
        person.role = role
    db.commit()

    # --- who heads it, and who covers it on the HR side --------------------
    head = by_handle["mostapha.aibi"]
    row = db.query(BuHeadAssignment).filter(BuHeadAssignment.bu == BU).first()
    if row:
        row.head_id = head.id
    else:
        db.add(BuHeadAssignment(bu=BU, head_id=head.id))

    hr = by_handle["aicha.abouaid"]
    if not db.query(HrBuAssignment).filter_by(bu=BU, hr_id=hr.id).first():
        db.add(HrBuAssignment(bu=BU, hr_id=hr.id))
    db.commit()
    print(f"head: {head.name} · HRBP: {hr.name}")

    # --- the two teams ------------------------------------------------------
    for name, (manager_handle, members) in TEAMS.items():
        manager = by_handle[manager_handle]
        team = db.query(Team).filter(Team.name == name).first()
        if not team:
            team = Team(name=name)
            db.add(team)
        team.manager_id = manager.id
        # The manager leads their own practice here; a separate skill lead can
        # be appointed later without touching this.
        team.lead_id = manager.id
        db.commit()
        db.refresh(team)

        for handle in members:
            by_handle[handle].team_id = team.id
        manager.team_id = team.id
        db.commit()
        print(f"team {team.name} (#{team.id}): {manager.name} + {len(members)} members")

    db.close()


if __name__ == "__main__":
    main()
