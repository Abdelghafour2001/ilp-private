"""Roles and reporting perimeters, in one place.

The audit found `_is_admin` defined six times with two different meanings —
`admin` in some modules, `admin or hr` in others. Same name, different
privilege. These predicates are the single definition; new code should import
them rather than write another local copy.

The role ladder, from narrowest to widest:

    user  <  trainer  <  manager  <  bu_head  <  hr  <  hr_lead  <  admin

`manager` runs a team; `bu_head` runs a BU and therefore every team inside it —
Mostapha heads AI & Data, which holds both the Data Practice and the AI Factory
under two different managers. That is a real chain, not two siblings: a training
request goes to the N+1 manager first and to the BU head second, because the BU
head owns the budget line the manager is spending.

`skill_lead` is gone. It sat beside `manager` with the same reach and no
distinct meaning, so it made the hierarchy ambiguous without granting anything:
two names for one rung is how an org chart stops being readable.

`hr` (HRBP) sees the BUs assigned to them. `hr_lead` — the L&D / HR lead — sees
every HRBP, the perimeters they cover, and the whole organisation, but does not
get platform administration: they run people and reporting, not labs, roles and
deletions. That separation is deliberate; conflating them is how "HR can see
everything" quietly becomes "HR can change anything".

Money is narrower than people. Cost is visible to `hr_lead` and `admin` only —
a manager approving a request sees that a course costs *something* through the
request itself, but the organisation's training spend is an L&D figure, not a
line-management one.
"""

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import BuHeadAssignment, HrBuAssignment, Learner, Team

ROLES = ("user", "trainer", "manager", "bu_head", "hr", "hr_lead", "admin")

# Roles that may curate shared content: skills, role profiles, catalogue entries.
CURATOR_ROLES = ("trainer", "manager", "bu_head", "hr", "hr_lead", "admin")
# Roles that oversee people rather than content.
OVERSEER_ROLES = ("manager", "bu_head", "hr", "hr_lead", "admin")
# Roles that may read org-wide reporting (HRBPs get a scoped version of it).
REPORTING_ROLES = ("hr", "hr_lead", "admin")
# Roles that may see money: training cost, budget, spend.
COST_ROLES = ("hr_lead", "admin")
# Roles that may create people. Deliberately not `hr`: an HRBP reports on their
# perimeter, they do not open accounts for it.
ONBOARDER_ROLES = ("hr_lead", "admin")


def can_see_cost(learner: Learner | None, token: str | None = None) -> bool:
    """Training spend is an L&D figure, not a line-management one.

    A manager still sees the price of the single request they are deciding —
    that is the decision in front of them. What they do not get is the
    organisation's cost column, which is budget, not supervision.
    """
    return is_admin_token(token) or (learner is not None and learner.role in COST_ROLES)


def can_onboard(learner: Learner | None, token: str | None = None) -> bool:
    """Who may create a new collaborator's account."""
    return is_admin_token(token) or (
        learner is not None and learner.role in ONBOARDER_ROLES
    )


def bu_perimeter(db: Session, learner: Learner) -> list[str]:
    """The BUs somebody heads. Empty for everyone who is not a BU head."""
    rows = db.query(BuHeadAssignment).filter(BuHeadAssignment.head_id == learner.id).all()
    return sorted({r.bu for r in rows if r.bu})


def bu_head_for(db: Session, bu: str) -> Learner | None:
    """Who heads this BU, if anyone.

    Returns None rather than raising: a BU with no head is a real state of the
    world, and the approval chain reports it as a blocked step instead of
    pretending the stage does not exist.
    """
    if not bu:
        return None
    row = db.query(BuHeadAssignment).filter(BuHeadAssignment.bu == bu).first()
    return db.get(Learner, row.head_id) if row else None


def is_admin_token(token: str | None) -> bool:
    return bool(settings.admin_token) and token == settings.admin_token


def is_platform_admin(learner: Learner | None, token: str | None = None) -> bool:
    """Full platform administration: roles, labs, deletions, integrations."""
    return is_admin_token(token) or (learner is not None and learner.role == "admin")


def is_people_admin(learner: Learner | None, token: str | None = None) -> bool:
    """Can act on any person or team, but not necessarily on the platform."""
    return is_platform_admin(learner, token) or (
        learner is not None and learner.role in ("hr", "hr_lead")
    )


def can_curate(learner: Learner | None, token: str | None = None) -> bool:
    return is_platform_admin(learner, token) or (
        learner is not None and learner.role in CURATOR_ROLES
    )


def can_read_reporting(learner: Learner | None, token: str | None = None) -> bool:
    return is_platform_admin(learner, token) or (
        learner is not None and learner.role in REPORTING_ROLES
    )


def hr_perimeter(db: Session, learner: Learner) -> list[str]:
    """The BUs an HRBP is responsible for.

    Explicit assignments only. An HRBP with no assignment sees nothing — the
    previous behaviour, where a blank profile field meant "the whole company",
    granted the widest possible access by omission, which is exactly backwards
    for a payload carrying matricules.
    """
    rows = db.query(HrBuAssignment).filter(HrBuAssignment.hr_id == learner.id).all()
    if rows:
        return sorted({r.bu for r in rows if r.bu})
    # Legacy fallback: an HRBP configured before perimeters existed keeps the
    # single BU on their profile. Still not "everything".
    return [learner.bu] if learner.bu else []


class Scope:
    """Which people a viewer may see.

    `learner_ids is None` means the whole organisation. An empty set means
    nobody — which is a real, safe answer, and a different thing from None.
    """

    def __init__(self, learner_ids: set[int] | None, label: str, bus: list[str] | None = None):
        self.learner_ids = learner_ids
        self.label = label
        self.bus = bus or []

    @property
    def org_wide(self) -> bool:
        return self.learner_ids is None

    def allows(self, learner_id: int | None) -> bool:
        return self.learner_ids is None or learner_id in self.learner_ids


def reporting_scope(db: Session, viewer: Learner | None, token: str | None = None) -> Scope:
    """The slice of the organisation a reporting viewer is entitled to."""
    if is_admin_token(token):
        return Scope(None, "Toute l'organisation")
    if viewer is None:
        return Scope(set(), "Aucun périmètre")
    if viewer.role in ("admin", "hr_lead"):
        return Scope(None, "Toute l'organisation")
    if viewer.role == "hr":
        bus = hr_perimeter(db, viewer)
        if not bus:
            return Scope(set(), "Aucune BU assignée")
        ids = {
            row[0] for row in db.query(Learner.id).filter(Learner.bu.in_(bus)).all()
        }
        label = f"BU {bus[0]}" if len(bus) == 1 else f"{len(bus)} BU"
        return Scope(ids, label, bus)
    return Scope(set(), "Aucun périmètre")


def oversight_scope(db: Session, viewer: Learner | None, token: str | None = None) -> Scope:
    """The people a viewer oversees, for follow-up views rather than reporting.

    Wider than `reporting_scope`, which only answers for HR: a manager follows
    their own team and a BU head every team in their BU, even though neither
    gets the HR reporting board. Anyone else oversees nobody but themselves.
    """
    reporting = reporting_scope(db, viewer, token)
    if reporting.org_wide or (viewer is not None and viewer.role == "hr"):
        return reporting
    if viewer is None:
        return Scope(set(), "Aucun périmètre")

    if viewer.role == "bu_head":
        bus = bu_perimeter(db, viewer)
        ids = {
            row[0] for row in db.query(Learner.id).filter(Learner.bu.in_(bus)).all()
        } if bus else set()
        label = f"BU {bus[0]}" if len(bus) == 1 else (f"{len(bus)} BU" if bus else "Aucune BU")
        return Scope(ids | {viewer.id}, label, bus)

    team_ids = [
        row[0]
        for row in db.query(Team.id)
        .filter((Team.manager_id == viewer.id) | (Team.lead_id == viewer.id))
        .all()
    ]
    if team_ids:
        ids = {
            row[0]
            for row in db.query(Learner.id).filter(Learner.team_id.in_(team_ids)).all()
        }
        return Scope(ids | {viewer.id}, "Mon équipe")
    return Scope({viewer.id}, "Moi")
