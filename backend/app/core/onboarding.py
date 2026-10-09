"""Bringing a new collaborator onto the platform.

A new recruit should arrive to a plan, not an empty dashboard. Two kinds of
pathway are waiting for them on day one: the ones everyone at the company walks,
and the ones specific to the unit they joined. Both are marked `auto_assign` and
matched on `audience_bu` — empty for company-wide, a BU name for unit-specific.

The alternative was for somebody in L&D to remember to assign a path to each
joiner. That works until the week it does not, and the person who notices is the
recruit sitting in front of a blank screen on their first morning.

Creating the account is deliberately L&D's job and nobody else's (see
`rbac.can_onboard`). An HRBP reports on their perimeter; they do not open
accounts for it, and a manager certainly does not.
"""

import datetime as dt
import logging

from sqlalchemy.orm import Session

from app.core.notifier import notify
from app.models import Learner, Pathway, PathwayEnrollment

log = logging.getLogger(__name__)


def pathways_for(db: Session, learner: Learner) -> list[Pathway]:
    """The pathways a recruit in this BU should start with.

    Company-wide first, then the BU's own — which is the order they should be
    read in, and the order they are assigned in so the due dates line up
    sensibly if any are set later.
    """
    rows = db.query(Pathway).filter(Pathway.auto_assign.is_(True)).all()
    company = [p for p in rows if not p.audience_bu]
    unit = [p for p in rows if p.audience_bu and p.audience_bu == (learner.bu or "")]
    return sorted(company, key=lambda p: p.title.lower()) + sorted(
        unit, key=lambda p: p.title.lower()
    )


def assign_starting_pathways(
    db: Session, learner: Learner, *, assigned_by: str = "L&D", due_days: int | None = 30
) -> list[Pathway]:
    """Enrol a recruit on their starting pathways. Idempotent.

    Re-running is safe and is expected: someone's BU can be corrected days after
    their account is created, and they should then pick up their unit's path
    without losing the company one they may already have started.
    """
    wanted = pathways_for(db, learner)
    if not wanted:
        return []

    existing = {
        row[0]
        for row in db.query(PathwayEnrollment.pathway_id)
        .filter(PathwayEnrollment.learner_id == learner.id)
        .all()
    }
    due = (
        dt.date.today() + dt.timedelta(days=due_days)
        if due_days is not None
        else None
    )

    added: list[Pathway] = []
    for pathway in wanted:
        if pathway.id in existing:
            continue
        db.add(
            PathwayEnrollment(
                pathway_id=pathway.id,
                learner_id=learner.id,
                assigned_by=assigned_by,
                # Mandatory paths get a deadline; optional ones are offered, not
                # imposed, and a due date on something optional is just noise.
                due_date=due if pathway.mandatory else None,
            )
        )
        added.append(pathway)

    if added:
        titles = ", ".join(p.title for p in added[:4])
        more = f" (+{len(added) - 4})" if len(added) > 4 else ""
        notify(
            db,
            [learner.id],
            kind="pathway",
            title="Bienvenue — votre parcours de démarrage",
            body=f"{len(added)} parcours vous attendent : {titles}{more}.",
            link="/pathways",
        )
    log.info(
        "onboarding: %s assigned %d pathway(s) in BU %r",
        learner.handle,
        len(added),
        learner.bu,
    )
    return added
