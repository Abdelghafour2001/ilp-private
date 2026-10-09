"""Add HR as a unit of its own, with the people who actually run it.

HR sat nowhere: Aicha had no BU at all (org-wide, which is true of her reporting
but not of where she sits), and the two HR members had been scattered into
delivery practices by the random placement. A support function is still a place
on the org chart.

Ichrac Marmari heads it. Her account is created if it does not exist — she is
named as the head, so an org chart without her would be wrong.

Note her reporting scope is unchanged: `hr_lead` sees the whole organisation
whatever unit the person sits in, so giving Aicha a BU does not narrow what she
can read.

    podman exec -i <backend> python - < app/ops_add_hr_unit.py
"""

from __future__ import annotations

from app.db.session import SessionLocal
from app.models import BuHeadAssignment, BusinessUnit, Learner, Practice, Team

BU = "HR"
PRACTICE = "HR"
TEAM = "HR Team"

HEAD = ("ichrac.marmari", "Ichrac Marmari", "ichrac.marmari@teal.ma")
# Aicha manages the team day to day; she is L&D lead, which is a wider job than
# this one unit, but this is where she sits.
MEMBERS = ["aicha.abouaid", "maryam.bakh", "khalid.ou"]
MANAGER = "aicha.abouaid"


def main() -> None:
    db = SessionLocal()

    # --- the unit and its practice -----------------------------------------
    unit = db.query(BusinessUnit).filter(BusinessUnit.name == BU).first()
    if not unit:
        last = db.query(BusinessUnit).order_by(BusinessUnit.position.desc()).first()
        unit = BusinessUnit(name=BU, code="HR", position=(last.position + 1) if last else 1)
        db.add(unit)
    unit.archived = False
    db.commit()
    db.refresh(unit)

    practice = (
        db.query(Practice).filter(Practice.bu_id == unit.id, Practice.name == PRACTICE).first()
    )
    if not practice:
        db.add(Practice(bu_id=unit.id, name=PRACTICE, position=1))
    db.commit()

    # --- the head ----------------------------------------------------------
    handle, name, email = HEAD
    head = db.query(Learner).filter(Learner.handle == handle).first()
    if not head:
        head = Learner(handle=handle, name=name, email=email, locale="fr")
        db.add(head)
        db.commit()
        db.refresh(head)
    head.name = head.name or name
    head.role = "bu_head"
    head.bu = BU
    head.practice = ""  # a head sits above the practices, not inside one
    row = db.query(BuHeadAssignment).filter(BuHeadAssignment.bu == BU).first()
    if row:
        row.head_id = head.id
    else:
        db.add(BuHeadAssignment(bu=BU, head_id=head.id))
    db.commit()

    # --- the team ----------------------------------------------------------
    team = db.query(Team).filter(Team.name == TEAM).first()
    if not team:
        team = Team(name=TEAM)
        db.add(team)
    db.commit()
    db.refresh(team)

    people = {l.handle: l for l in db.query(Learner).filter(Learner.handle.in_(MEMBERS)).all()}
    missing = [h for h in MEMBERS if h not in people]
    if missing:
        print("missing:", ", ".join(missing))

    for handle in MEMBERS:
        person = people.get(handle)
        if not person:
            continue
        person.bu = BU
        person.practice = PRACTICE
        person.team_id = team.id

    manager = people.get(MANAGER)
    if manager:
        team.manager_id = manager.id
        team.lead_id = manager.id
    db.commit()

    members = db.query(Learner).filter(Learner.team_id == team.id).count()
    print(f"{BU}: head {head.name}, team « {TEAM} » with {members} member(s)")
    for handle in MEMBERS:
        p = people.get(handle)
        if p:
            print(f"  {p.name or p.handle} · {p.role}")
    db.close()


if __name__ == "__main__":
    main()
