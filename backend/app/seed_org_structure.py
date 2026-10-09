"""Reshape the demo onto the client's own org chart.

The seed shipped with mining-flavoured BUs (Exploration, Mining Operations).
The real organisation is structured by partner-level units, and one of them —
AI & Data — holds two practices under two different managers. That last detail
is the reason this exists: a BU that is one team with one manager can be faked
with a flat list, and the org chart only earns its keep when a BU genuinely
branches.

Teams carry no BU column; people do. So re-homing a team means moving its
members, and the chart follows. Run after `seed_all` and `seed_governance`:

    python -m app.seed_org_structure [--force]
"""

import sys

from app.db.session import SessionLocal
from app.api.routes.approvals import build_chain
from app.models import (
    ApprovalStep,
    BuHeadAssignment,
    HrBuAssignment,
    Learner,
    Pathway,
    Team,
    TrainingRequest,
)

# The partner-level units, in the order they sit on the client's chart.
BUS = [
    "Finance & Administration",
    "HR & Culture",
    "AI & Data",
    "Digital Operations & Technology",
    "Engineering & Automation",
    "Transformation & Business Excellence",
    "Marketing & Alliances",
    "NextGen Enterprise Solutions",
    "Digital Forge",
]

# handle -> (BU, practice). Practices are the sub-unit inside a BU, which is
# what the chart calls out under AI & Data.
PEOPLE = {
    # --- AI & Data: one BU head over two practices, two managers ------------
    "mostapha.aibi":         ("AI & Data", "Direction AI & Data"),
    "omar.elouafi":          ("AI & Data", "AI Factory"),
    "abdelghafour.lahrache": ("AI & Data", "AI Factory"),
    "salma.elbarbori":       ("AI & Data", "AI Factory"),
    "leila.senhaji":         ("AI & Data", "Data Practice"),
    "karim.mansouri":        ("AI & Data", "Data Practice"),
    "nadia.bouzid":          ("AI & Data", "Data Practice"),
    "omar.tazi":             ("AI & Data", "Data Practice"),
    "yasmine.alaoui":        ("AI & Data", "Data Practice"),
    "sofia":                 ("AI & Data", "Data Practice"),
    # --- Digital Operations & Technology ------------------------------------
    "hicham.raji":     ("Digital Operations & Technology", "Portfolio Management"),
    "salma.idrissi":   ("Digital Operations & Technology", "IT Operations"),
    "youssef.benali":  ("Digital Operations & Technology", "IT Operations"),
    "imane.zahraoui":  ("Digital Operations & Technology", "Cybersecurity"),
    "sara.amrani":     ("Digital Operations & Technology", "Portfolio Management"),
    "mehdi":           ("Digital Operations & Technology", "IT Operations"),
    # --- HR & Culture: the HR line itself sits here, and covers other BUs ----
    "aicha.abouaid":       ("HR & Culture", "Compétences & Formation"),
    "khalid.ou":           ("HR & Culture", "HR Business Partners"),
    "maryam.bakh":         ("HR & Culture", "HR Business Partners"),
    "fatima.benjelloun":   ("HR & Culture", "Talent Acquisition & Onboarding"),
    # --- the remaining partner units ----------------------------------------
    "rachid.berrada": ("Engineering & Automation", "Automation Solutions"),
    "amina":          ("Transformation & Business Excellence", "Transformation"),
    "ava":            ("Marketing & Alliances", "Marketing"),
    "liam":           ("NextGen Enterprise Solutions", "Account Management"),
    "maya":           ("Digital Forge", "Digital Products"),
    "noah":           ("Digital Forge", "Product Experience"),
    "elouafi.omar":   ("Finance & Administration", "Financial Operations"),
}

# Existing teams, renamed to the practices they actually are. Keyed by the
# manager's handle rather than the team's current name, so re-running this after
# a rename still finds the right team instead of silently doing nothing.
TEAMS_BY_MANAGER = {
    "omar.elouafi": "AI Factory",
    "leila.senhaji": "Data Practice",
    "hicham.raji": "IT Operations & Portfolio",
}

# What a new recruit lands on. An empty BU means everyone at the company gets
# it; a BU name means only joiners in that unit do. Between them, someone
# starting in AI & Data arrives to the company induction *and* their unit's
# path, with nobody having had to remember either.
STARTING_PATHWAYS = {
    "Sécurité & conformité — socle": "",
    "Data Analyst Onboarding": "AI & Data",
}


# One HRBP does not cover nine BUs, so the perimeters are split. NextGen
# Enterprise Solutions is left to nobody on purpose: the chart's gap-detection
# needs something to find, and a demo where everything is covered proves less.
# Who heads which BU. A BU head sits above the team managers and takes the
# second stage of every training request raised inside their unit — Mostapha
# signs off what Omar and Leila approve, because the budget line is his.
BU_HEADS = {
    "mostapha.aibi": ["AI & Data"],
}

HR_PERIMETERS = {
    "khalid.ou": [
        "AI & Data",
        "Digital Operations & Technology",
        "Finance & Administration",
        "Marketing & Alliances",
    ],
    "maryam.bakh": [
        "HR & Culture",
        "Engineering & Automation",
        "Transformation & Business Excellence",
        "Digital Forge",
    ],
}


def seed(force: bool = False) -> None:
    db = SessionLocal()
    try:
        if not force:
            already = db.query(Learner).filter(Learner.bu == "AI & Data").first()
            if already:
                print("Org structure already applied. Use --force to re-apply.")
                return

        moved = 0
        for handle, (bu, practice) in PEOPLE.items():
            person = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
            if not person:
                continue
            person.bu = bu
            person.practice = practice
            moved += 1

        # Team names are unique, so two teams trading names collides mid-update.
        # Park every affected team on a temporary name first, then assign the
        # real ones — otherwise swapping two practices is impossible.
        pending: list[tuple[Team, str]] = []
        for manager_handle, name in TEAMS_BY_MANAGER.items():
            manager = db.query(Learner).filter(Learner.handle.ilike(manager_handle)).first()
            if not manager:
                continue
            team = db.query(Team).filter(Team.manager_id == manager.id).first()
            if team and team.name != name:
                pending.append((team, name))

        for team, _ in pending:
            team.name = f"__migrating__{team.id}"
        db.flush()
        for team, name in pending:
            team.name = name
        renamed = len(pending)

        heads = 0
        for handle, bus in BU_HEADS.items():
            head = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
            if not head:
                continue
            head.role = "bu_head"
            db.query(BuHeadAssignment).filter_by(head_id=head.id).delete()
            for bu in bus:
                db.add(BuHeadAssignment(head_id=head.id, bu=bu, assigned_by_name="Aicha Abouaid"))
            heads += 1

        perimeters = 0
        for handle, bus in HR_PERIMETERS.items():
            hrbp = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
            if not hrbp:
                continue
            db.query(HrBuAssignment).filter_by(hr_id=hrbp.id).delete()
            for bu in bus:
                db.add(HrBuAssignment(hr_id=hrbp.id, bu=bu, assigned_by_name="Aicha Abouaid"))
            perimeters += 1

        # --- what new recruits start on ------------------------------------
        auto = 0
        for title, audience in STARTING_PATHWAYS.items():
            pathway = db.query(Pathway).filter(Pathway.title == title).first()
            if not pathway:
                # The company-wide induction may not be in the catalogue yet;
                # create it rather than silently onboarding people onto nothing.
                pathway = Pathway(
                    title=title,
                    summary=(
                        "Le socle que suit toute personne qui rejoint l'entreprise : "
                        "sécurité, conformité, et comment on travaille ici."
                    ),
                    emoji="🛡️",
                    mandatory=True,
                )
                db.add(pathway)
                db.flush()
            pathway.auto_assign = True
            pathway.audience_bu = audience
            auto += 1

        # Approval chains last: they resolve the BU head from the assignments
        # set just above, so rebuilding them any earlier produces a second stage
        # with nobody on it.
        chains = 0
        for request in db.query(TrainingRequest).all():
            requester = db.get(Learner, request.learner_id)
            if not requester:
                continue
            db.query(ApprovalStep).filter_by(request_id=request.id).delete()
            db.flush()
            steps = build_chain(db, request, requester)
            if request.status == "pending":
                # Leave one request already past its manager, so the demo has
                # something waiting on the BU head rather than everything
                # stacked on the same desk.
                if request.id % 2 == 0 and len(steps) > 1:
                    steps[0].status = "approved"
                    steps[0].note = "OK pour moi, a valider cote BU."
                    steps[0].decided_at = request.created_at
            else:
                for step in steps:
                    step.status = request.status
                    step.note = request.decision_note
                    step.decided_at = request.decided_at
            chains += 1

        db.commit()

        covered = {bu for bus in HR_PERIMETERS.values() for bu in bus}
        print("Org structure applied:")
        print(f"  BUs: {len(BUS)}  ·  people re-homed: {moved}  ·  teams renamed: {renamed}")
        print(f"  BU heads set: {heads}  ·  HRBP perimeters set: {perimeters}")
        print(f"  approval chains rebuilt: {chains}")
        print(f"  starting pathways for new recruits: {auto}")
        print(f"  deliberately uncovered: {', '.join(sorted(set(BUS) - covered)) or 'none'}")
        print("  AI & Data holds two practices: AI Factory (Omar), Data Practice (Leila)")
    finally:
        db.close()


if __name__ == "__main__":
    seed(force="--force" in sys.argv)
