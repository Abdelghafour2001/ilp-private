"""The organisation, as something L&D can change rather than only read.

Everything the org chart shows is now editable from one place: business units
and their order, who heads each one, which BUs an HRBP covers, teams and their
managers, and each person's role, title and posting. Plus invitations, because
"who exists on this platform" is the same decision as "who is in the chart".

All of it is `hr_lead` or `admin`. Not `hr`: an HRBP reports on their perimeter,
they do not redraw it — an HRBP who could assign their own BUs would make the
perimeter model decorative. Not `bu_head` either: heading a unit is authority
over its people, not over the shape of the company.

Two rules run through the writes.

**Renaming a BU rewrites the people in it.** `learners.bu` is a string, so a
rename that touched only the registry would strand everyone under the old name —
they would vanish from the chart while still counting in totals. It happens in
one transaction with the perimeter and head assignments that reference it.

**Nothing is deleted while it still explains history.** A BU is archived, a
person is deactivated. A closed unit still owns last year's hours, and deleting
it would silently drop them from every historical report.
"""

import datetime as dt
import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email_template import Button, render_email
from app.core.mailer import send_email
from app.core.notifier import notify
from app.core.onboarding import assign_starting_pathways, pathways_for
from app.core.rbac import ROLES, bu_perimeter, hr_perimeter, is_admin_token
from app.db.session import get_db
from app.models import (
    BuHeadAssignment,
    BusinessUnit,
    HrBuAssignment,
    Practice,
    Learner,
    Team,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/governance", tags=["governance"])


def _steward(db: Session, learner_id: int | None, token: str | None) -> Learner | None:
    """Who may reshape the organisation: L&D and platform admins, nobody else."""
    if is_admin_token(token):
        return db.get(Learner, learner_id) if learner_id else None
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not viewer or viewer.role not in ("hr_lead", "admin"):
        raise HTTPException(
            status_code=403,
            detail="Seul le service Formation (L&D) ou un administrateur peut modifier l'organisation.",
        )
    return viewer


def _actor(viewer: Learner | None) -> str:
    return (viewer.name or viewer.handle) if viewer else "Administration"


def _person_brief(p: Learner | None) -> dict | None:
    if p is None:
        return None
    return {
        "id": p.id,
        "handle": p.handle,
        "name": p.name or p.handle,
        "role": p.role,
        "title": p.title or "",
    }


# --------------------------------------------------------------------------- #
# the whole picture                                                           #
# --------------------------------------------------------------------------- #


@router.get("/overview")
def overview(
    learner_id: int | None = None,
    include_archived: bool = False,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Everything the editor needs in one call: units, heads, HRBPs, teams.

    One request rather than four, because the page is a single editable tree and
    fetching its parts separately guarantees a moment where the screen shows a
    unit whose head has not arrived yet.
    """
    _steward(db, learner_id, x_admin_token)

    people = db.query(Learner).all()
    by_id = {p.id: p for p in people}
    headcount: dict[str, int] = {}
    for p in people:
        if p.bu:
            headcount[p.bu] = headcount.get(p.bu, 0) + 1

    heads: dict[str, Learner] = {}
    for row in db.query(BuHeadAssignment).all():
        holder = by_id.get(row.head_id)
        if holder:
            heads[row.bu] = holder

    hrbps: dict[str, list[dict]] = {}
    for row in db.query(HrBuAssignment).all():
        holder = by_id.get(row.hr_id)
        if holder:
            hrbps.setdefault(row.bu, []).append(_person_brief(holder))

    teams_by_bu: dict[str, list[dict]] = {}
    for team in db.query(Team).order_by(Team.name).all():
        members = [p for p in people if p.team_id == team.id]
        # A team has no BU of its own; it sits where most of its members do.
        counts: dict[str, int] = {}
        for m in members:
            if m.bu:
                counts[m.bu] = counts.get(m.bu, 0) + 1
        bu = max(counts, key=lambda k: (counts[k], k)) if counts else ""
        teams_by_bu.setdefault(bu, []).append({
            "id": team.id,
            "name": team.name,
            "manager": _person_brief(by_id.get(team.manager_id)),
            "member_count": len(members),
        })

    units = db.query(BusinessUnit).order_by(BusinessUnit.position, BusinessUnit.name)
    if not include_archived:
        units = units.filter(BusinessUnit.archived.is_(False))

    practices: dict[int, list[Practice]] = {}
    for row in db.query(Practice).filter(Practice.archived.is_(False)).all():
        practices.setdefault(row.bu_id, []).append(row)
    practice_counts: dict[tuple[str, str], int] = {}
    for bu, practice, count in (
        db.query(Learner.bu, Learner.practice, func.count())
        .filter(Learner.practice != "")
        .group_by(Learner.bu, Learner.practice)
        .all()
    ):
        practice_counts[(bu, practice)] = count

    return {
        "business_units": [
            {
                "id": u.id,
                "name": u.name,
                "code": u.code,
                "description": u.description,
                "position": u.position,
                "archived": u.archived,
                "head": _person_brief(heads.get(u.name)),
                "hrbps": hrbps.get(u.name, []),
                "teams": teams_by_bu.get(u.name, []),
                "headcount": headcount.get(u.name, 0),
                # The métiers inside the unit, with how many people are in each
                # — the number is what tells L&D whether one can be archived.
                "practices": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "position": p.position,
                        "headcount": practice_counts.get((u.name, p.name), 0),
                    }
                    for p in sorted(
                        practices.get(u.id, []), key=lambda r: (r.position, r.name)
                    )
                ],
            }
            for u in units.all()
        ],
        # Teams that belong to no unit, because nobody in them has a BU — or
        # because nobody is in them at all. They were invisible in this console
        # before: grouped under a blank BU, so they appeared on no BU card and
        # could not be reached, let alone deleted. They show as "Sans BU" on the
        # org chart, which is how people found out they were still there.
        "unattached_teams": teams_by_bu.get("", []),
        # People tagged with a BU that has no row — only possible from data
        # imported before the registry existed, and worth fixing rather than
        # hiding, because they are invisible in the chart today.
        "orphan_bus": sorted(
            {
                p.bu
                for p in people
                if p.bu and p.bu not in {u.name for u in db.query(BusinessUnit).all()}
            }
        ),
        "unassigned_people": [
            _person_brief(p) for p in people if not p.bu and p.role != "admin"
        ],
        "roles": list(ROLES),
    }


# --------------------------------------------------------------------------- #
# business units                                                              #
# --------------------------------------------------------------------------- #


class BuIn(BaseModel):
    learner_id: int | None = None
    name: str = Field(min_length=2, max_length=80)
    code: str = ""
    description: str = ""
    position: int | None = None


@router.post("/bus", status_code=201)
def create_bu(
    payload: BuIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _steward(db, payload.learner_id, x_admin_token)
    name = payload.name.strip()
    if db.query(BusinessUnit).filter(BusinessUnit.name.ilike(name)).first():
        raise HTTPException(status_code=409, detail=f"« {name} » existe déjà.")

    last = db.query(BusinessUnit).order_by(BusinessUnit.position.desc()).first()
    unit = BusinessUnit(
        name=name,
        code=payload.code.strip()[:20],
        description=payload.description.strip()[:400],
        position=payload.position if payload.position is not None else (last.position + 1 if last else 1),
    )
    db.add(unit)
    db.commit()
    db.refresh(unit)
    return {"id": unit.id, "name": unit.name, "position": unit.position}


class BuPatch(BaseModel):
    learner_id: int | None = None
    name: str | None = None
    code: str | None = None
    description: str | None = None
    position: int | None = None
    archived: bool | None = None


@router.patch("/bus/{bu_id}")
def update_bu(
    bu_id: int,
    payload: BuPatch,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Rename, re-order or archive a unit.

    A rename carries the people with it. `learners.bu` is a string, so renaming
    only the registry row would strand everyone under the old name: gone from
    the chart, still counted in the totals. The head and HRBP assignments key on
    the name too, so all four move together or none do.
    """
    _steward(db, payload.learner_id, x_admin_token)
    unit = db.get(BusinessUnit, bu_id)
    if not unit:
        raise HTTPException(status_code=404, detail="BU introuvable.")

    moved = 0
    if payload.name and payload.name.strip() != unit.name:
        new_name = payload.name.strip()
        clash = (
            db.query(BusinessUnit)
            .filter(BusinessUnit.name.ilike(new_name), BusinessUnit.id != unit.id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"« {new_name} » existe déjà.")
        old_name = unit.name
        moved = db.query(Learner).filter(Learner.bu == old_name).update({"bu": new_name})
        db.query(HrBuAssignment).filter_by(bu=old_name).update({"bu": new_name})
        db.query(BuHeadAssignment).filter_by(bu=old_name).update({"bu": new_name})
        unit.name = new_name

    if payload.code is not None:
        unit.code = payload.code.strip()[:20]
    if payload.description is not None:
        unit.description = payload.description.strip()[:400]
    if payload.position is not None:
        unit.position = payload.position
    if payload.archived is not None:
        unit.archived = payload.archived

    db.commit()
    return {"id": unit.id, "name": unit.name, "people_moved": moved}


@router.delete("/bus/{bu_id}", status_code=204)
def archive_bu(
    bu_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Archive, never delete — a closed BU still owns last year's hours."""
    _steward(db, learner_id, x_admin_token)
    unit = db.get(BusinessUnit, bu_id)
    if not unit:
        return
    staffed = db.query(Learner).filter(Learner.bu == unit.name).count()
    if staffed:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{staffed} collaborateur(s) sont encore rattachés à « {unit.name} ». "
                "Déplacez-les avant d'archiver."
            ),
        )
    unit.archived = True
    # Perimeters and the head assignment key on the BU *name*, not its row, so
    # archiving used to leave them pointing at a unit that no longer exists —
    # which is how retired units kept showing up on the HR perimeters tab.
    db.query(HrBuAssignment).filter(HrBuAssignment.bu == unit.name).delete(
        synchronize_session=False
    )
    db.query(BuHeadAssignment).filter(BuHeadAssignment.bu == unit.name).delete(
        synchronize_session=False
    )
    db.commit()


class ReorderIn(BaseModel):
    learner_id: int | None = None
    order: list[int] = []


@router.post("/bus/reorder")
def reorder_bus(
    payload: ReorderIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Set the left-to-right order of the chart. The client's own chart has a
    deliberate order that alphabetical sorting destroys."""
    _steward(db, payload.learner_id, x_admin_token)
    for position, bu_id in enumerate(payload.order, start=1):
        unit = db.get(BusinessUnit, bu_id)
        if unit:
            unit.position = position
    db.commit()
    return {"ordered": len(payload.order)}


class AssignIn(BaseModel):
    learner_id: int | None = None
    # None clears the assignment, which is a real intent: a BU between heads.
    handle: str | None = None
    handles: list[str] | None = None


@router.put("/bus/{bu_id}/head")
def set_head(
    bu_id: int,
    payload: AssignIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Appoint (or clear) the head of a BU, granting the role as a side effect."""
    viewer = _steward(db, payload.learner_id, x_admin_token)
    unit = db.get(BusinessUnit, bu_id)
    if not unit:
        raise HTTPException(status_code=404, detail="BU introuvable.")

    db.query(BuHeadAssignment).filter_by(bu=unit.name).delete()
    if not payload.handle:
        db.commit()
        return {"bu": unit.name, "head": None}

    person = db.query(Learner).filter(Learner.handle.ilike(payload.handle.strip())).first()
    if not person:
        raise HTTPException(status_code=404, detail=f"Aucun collaborateur « {payload.handle} ».")

    db.add(BuHeadAssignment(head_id=person.id, bu=unit.name, assigned_by_name=_actor(viewer)))
    # Appointing someone head is what makes them one; requiring the role to be
    # granted separately is a two-step that people forget the second half of.
    if person.role in ("user", "trainer", "manager"):
        person.role = "bu_head"
    notify(
        db,
        [person.id],
        kind="role",
        title=f"Vous êtes responsable de la BU {unit.name}",
        body="Les demandes de formation de cette BU vous parviendront après validation du manager.",
        link="/approvals",
    )
    db.commit()
    return {"bu": unit.name, "head": _person_brief(person)}


@router.put("/bus/{bu_id}/hrbps")
def set_hrbps(
    bu_id: int,
    payload: AssignIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Set which HRBPs cover this BU. Replaces the list for this BU only."""
    viewer = _steward(db, payload.learner_id, x_admin_token)
    unit = db.get(BusinessUnit, bu_id)
    if not unit:
        raise HTTPException(status_code=404, detail="BU introuvable.")

    db.query(HrBuAssignment).filter_by(bu=unit.name).delete()
    assigned = []
    for handle in payload.handles or []:
        person = db.query(Learner).filter(Learner.handle.ilike(handle.strip())).first()
        if not person:
            continue
        if person.role == "user":
            person.role = "hr"
        db.add(HrBuAssignment(hr_id=person.id, bu=unit.name, assigned_by_name=_actor(viewer)))
        assigned.append(_person_brief(person))
    db.commit()
    return {"bu": unit.name, "hrbps": assigned}


# --------------------------------------------------------------------------- #
# teams                                                                       #
# --------------------------------------------------------------------------- #


class TeamIn(BaseModel):
    learner_id: int | None = None
    name: str = Field(min_length=2, max_length=120)
    description: str = ""
    manager_handle: str | None = None


@router.post("/teams", status_code=201)
def create_team(
    payload: TeamIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _steward(db, payload.learner_id, x_admin_token)
    name = payload.name.strip()
    if db.query(Team).filter(Team.name.ilike(name)).first():
        raise HTTPException(status_code=409, detail=f"L'équipe « {name} » existe déjà.")

    team = Team(name=name, description=payload.description.strip()[:400])
    if payload.manager_handle:
        manager = (
            db.query(Learner).filter(Learner.handle.ilike(payload.manager_handle.strip())).first()
        )
        if not manager:
            raise HTTPException(status_code=404, detail="Manager introuvable.")
        team.manager_id = manager.id
        if manager.role in ("user", "trainer"):
            manager.role = "manager"
    db.add(team)
    db.commit()
    db.refresh(team)
    return {"id": team.id, "name": team.name}


class TeamPatch(BaseModel):
    learner_id: int | None = None
    name: str | None = None
    description: str | None = None
    manager_handle: str | None = None


@router.patch("/teams/{team_id}")
def update_team(
    team_id: int,
    payload: TeamPatch,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _steward(db, payload.learner_id, x_admin_token)
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Équipe introuvable.")

    if payload.name and payload.name.strip() != team.name:
        new_name = payload.name.strip()
        clash = db.query(Team).filter(Team.name.ilike(new_name), Team.id != team.id).first()
        if clash:
            raise HTTPException(status_code=409, detail=f"« {new_name} » existe déjà.")
        team.name = new_name
    if payload.description is not None:
        team.description = payload.description.strip()[:400]
    if payload.manager_handle is not None:
        if payload.manager_handle == "":
            team.manager_id = None
        else:
            manager = (
                db.query(Learner)
                .filter(Learner.handle.ilike(payload.manager_handle.strip()))
                .first()
            )
            if not manager:
                raise HTTPException(status_code=404, detail="Manager introuvable.")
            team.manager_id = manager.id
            if manager.role in ("user", "trainer"):
                manager.role = "manager"
    db.commit()
    return {"id": team.id, "name": team.name}


@router.delete("/teams/{team_id}", status_code=204)
def delete_team(
    team_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _steward(db, learner_id, x_admin_token)
    team = db.get(Team, team_id)
    if not team:
        return
    members = db.query(Learner).filter(Learner.team_id == team.id).count()
    if members:
        raise HTTPException(
            status_code=409,
            detail=f"{members} membre(s) dans « {team.name} ». Déplacez-les d'abord.",
        )
    db.delete(team)
    db.commit()


# --------------------------------------------------------------------------- #
# people                                                                      #
# --------------------------------------------------------------------------- #


class PersonPatch(BaseModel):
    learner_id: int | None = None  # the L&D person making the change
    name: str | None = None
    email: str | None = None
    role: str | None = None
    title: str | None = None
    job_level: str | None = None
    practice: str | None = None
    location: str | None = None
    matricule: str | None = None
    bu: str | None = None
    team_id: int | None = None
    # Explicitly clearing a team is different from not mentioning it.
    clear_team: bool = False


@router.get("/people")
def list_people(
    learner_id: int | None = None,
    q: str = "",
    bu: str = "",
    role: str = "",
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """The people directory, with everything the editor can change."""
    _steward(db, learner_id, x_admin_token)
    teams = {t.id: t.name for t in db.query(Team).all()}

    query = db.query(Learner)
    if bu:
        query = query.filter(Learner.bu == bu)
    if role:
        query = query.filter(Learner.role == role)
    rows = query.order_by(Learner.name, Learner.handle).all()

    needle = q.strip().lower()
    if needle:
        rows = [
            r
            for r in rows
            if needle in (r.name or "").lower()
            or needle in r.handle.lower()
            or needle in (r.matricule or "").lower()
            or needle in (r.title or "").lower()
        ]

    return {
        "people": [
            {
                "id": r.id,
                "handle": r.handle,
                "name": r.name or r.handle,
                "email": r.email or "",
                "role": r.role,
                "title": r.title or "",
                "job_level": r.job_level or "",
                "practice": r.practice or "",
                "location": r.location or "",
                "matricule": r.matricule or "",
                "bu": r.bu or "",
                "team_id": r.team_id,
                "team": teams.get(r.team_id, ""),
                "heads_bus": bu_perimeter(db, r),
                "hr_bus": hr_perimeter(db, r) if r.role in ("hr", "hr_lead") else [],
            }
            for r in rows
        ],
        "count": len(rows),
    }


@router.patch("/people/{person_id}")
def update_person(
    person_id: int,
    payload: PersonPatch,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Change somebody's role, title or posting."""
    viewer = _steward(db, payload.learner_id, x_admin_token)
    person = db.get(Learner, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Collaborateur introuvable.")

    if payload.role is not None:
        if payload.role not in ROLES:
            raise HTTPException(
                status_code=400, detail="Rôle inconnu. Attendu : " + ", ".join(ROLES)
            )
        # An L&D lead cannot promote anyone to platform admin — that is a
        # different kind of power (roles, labs, deletions) and belongs with
        # whoever owns the platform, not with whoever owns the people.
        if payload.role == "admin" and not (
            is_admin_token(x_admin_token) or (viewer and viewer.role == "admin")
        ):
            raise HTTPException(
                status_code=403,
                detail="Seul un administrateur plateforme peut accorder le rôle admin.",
            )
        if person.role != payload.role:
            was = person.role
            person.role = payload.role
            notify(
                db,
                [person.id],
                kind="role",
                title=f"Votre rôle est passé de « {was} » à « {payload.role} »",
                body=f"Modifié par {_actor(viewer)}.",
                link="/",
            )

    if payload.bu is not None and payload.bu != person.bu:
        if payload.bu and not db.query(BusinessUnit).filter(BusinessUnit.name == payload.bu).first():
            raise HTTPException(
                status_code=400,
                detail=f"« {payload.bu} » n'est pas une BU enregistrée. Créez-la d'abord.",
            )
        person.bu = payload.bu

    for field in ("name", "email", "title", "job_level", "practice", "location", "matricule"):
        value = getattr(payload, field)
        if value is not None:
            setattr(person, field, value.strip())

    if payload.clear_team:
        person.team_id = None
    elif payload.team_id is not None:
        if not db.get(Team, payload.team_id):
            raise HTTPException(status_code=404, detail="Équipe introuvable.")
        person.team_id = payload.team_id

    db.commit()
    db.refresh(person)
    return {
        "id": person.id,
        "handle": person.handle,
        "role": person.role,
        "title": person.title,
        "bu": person.bu,
        "team_id": person.team_id,
    }


class InviteIn(BaseModel):
    learner_id: int | None = None
    handle: str = Field(min_length=2, max_length=60)
    name: str = ""
    email: str = ""
    role: str = "user"
    title: str = ""
    job_level: str = ""
    practice: str = ""
    location: str = ""
    matricule: str = ""
    bu: str = ""
    team_id: int | None = None
    send_email: bool = True


def _how_to_sign_in() -> str:
    """The sentence that tells a new colleague which door is open for them."""
    opening = "Votre accès à <b>" + settings.app_name + "</b>, la plateforme de formation, est ouvert. "
    if settings.auth_enabled and settings.password_login_enabled:
        return opening + ("Connectez-vous avec votre compte Microsoft, ou avec votre adresse "
                          "e-mail et le mot de passe qui vous a été communiqué.")
    if settings.auth_enabled:
        return opening + "Connectez-vous avec votre compte Microsoft."
    if settings.password_login_enabled:
        return opening + ("Connectez-vous avec votre adresse e-mail et le mot de passe qui vous "
                          "a été communiqué. Si vous n'en avez pas encore, demandez-le à l'équipe "
                          "formation : il n'y a pas de réinitialisation automatique.")
    return opening + "Connectez-vous avec votre identifiant."


@router.post("/invitations", status_code=201)
def invite(
    payload: InviteIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Create a collaborator, start them on their pathways, and tell them.

    The same operation as `/admin/recruits`, with the invitation email and the
    full posting in one step — the difference between "the account exists" and
    "the person knows it exists and what to do first".
    """
    viewer = _steward(db, payload.learner_id, x_admin_token)

    handle = payload.handle.strip().lower()
    if db.query(Learner).filter(Learner.handle.ilike(handle)).first():
        raise HTTPException(status_code=409, detail=f"« {handle} » existe déjà.")
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Rôle inconnu.")
    if payload.role == "admin" and not (
        is_admin_token(x_admin_token) or (viewer and viewer.role == "admin")
    ):
        raise HTTPException(
            status_code=403, detail="Seul un administrateur plateforme peut créer un admin."
        )
    if payload.bu and not db.query(BusinessUnit).filter(BusinessUnit.name == payload.bu).first():
        raise HTTPException(
            status_code=400, detail=f"« {payload.bu} » n'est pas une BU enregistrée."
        )

    person = Learner(
        handle=handle,
        name=payload.name.strip() or handle,
        email=payload.email.strip(),
        role=payload.role,
        title=payload.title.strip(),
        job_level=payload.job_level.strip(),
        practice=payload.practice.strip(),
        location=payload.location.strip(),
        matricule=payload.matricule.strip(),
        bu=payload.bu.strip(),
        team_id=payload.team_id,
    )
    db.add(person)
    db.flush()

    assigned = assign_starting_pathways(db, person, assigned_by=_actor(viewer))
    db.commit()
    db.refresh(person)

    emailed = False
    if payload.send_email and person.email:
        emailed = send_welcome(person, assigned, _actor(viewer))

    return {
        "id": person.id,
        "handle": person.handle,
        "name": person.name,
        "role": person.role,
        "bu": person.bu,
        "pathways": [{"id": p.id, "title": p.title} for p in assigned],
        # Reported rather than assumed: an invitation nobody received is a
        # different outcome from one that bounced, and both look like success
        # if the caller only checks the status code.
        "emailed": emailed,
        "email_configured": bool(person.email),
    }


@router.get("/invitations/preview")
def invitation_preview(
    bu: str = "",
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """What a joiner in this BU will be given, before anyone is created."""
    _steward(db, learner_id, x_admin_token)
    probe = Learner(handle="__preview__", bu=bu.strip())
    return {
        "bu": bu.strip(),
        "pathways": [
            {"id": p.id, "title": p.title, "mandatory": p.mandatory,
             "scope": p.audience_bu or "all"}
            for p in pathways_for(db, probe)
        ],
    }


def send_welcome(person: Learner, pathways: list, actor: str) -> bool:
    """The welcome mail. One wording, whether it is the first send or a resend.

    Deliberately not a password: this says where the door is and who opened the
    account. The password is handed over by a person, because mailing somebody
    their own credentials puts them in an inbox for ever.
    """
    blocks: list = [
        ("p", f"Bonjour {person.name or person.handle},"),
        # How they actually get in, read from the deployment rather than
        # assumed — the mail used to say "connectez-vous avec votre compte
        # Microsoft" on a server where SSO is off.
        ("p", _how_to_sign_in()),
        # The address they sign in with, not the handle. The handle is how the
        # system refers to them; the login form asks for an e-mail, and naming
        # the wrong one under "Identifiant" sends people to a field that
        # rejects it. The handle only appears when there is no address.
        ("stats", [("Identifiant", person.email or person.handle)]),
    ]
    if settings.password_login_enabled:
        # Said here because nothing else says it: the password they were handed
        # stops working the moment they use it, and somebody who is not warned
        # reads the "choose your password" screen as the app refusing them.
        blocks.append((
            "p",
            "Le mot de passe qui vous a été communiqué est <b>à usage unique</b> : "
            "à la première connexion, l'application vous demandera d'en choisir "
            "un nouveau, connu de vous seul.",
        ))
    if pathways:
        blocks.append(("h", "Vos parcours de démarrage"))
        blocks.append(("list", [p.title for p in pathways]))
    html, body_text = render_email(
        heading=f"Bienvenue sur {settings.app_name}",
        preheader="Votre accès à la plateforme de formation est ouvert.",
        blocks=blocks,
        button=Button(f"Ouvrir {settings.app_name}", settings.frontend_origin),
        footer_note=f"Invitation envoyée par {actor}.",
    )
    return bool(send_email(person.email, f"Bienvenue sur {settings.app_name}", html, body_text))


class ResendIn(BaseModel):
    learner_id: int | None = None
    # Addresses or handles — whichever the person asking has to hand.
    people: list[str] = Field(min_length=1, max_length=200)


@router.post("/invitations/resend")
def resend_invitations(
    payload: ResendIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Send the welcome mail again, to people who already have an account.

    Invitations get lost: a filter eats them, somebody is on leave for three
    weeks, an address was wrong and has since been fixed. Re-inviting through
    the create endpoint would answer 409, so this exists instead — it creates
    nothing, changes nothing, and tells you per address what happened.

    Each outcome is reported separately on purpose. "Not sent" and "no such
    person" and "that account has no address" are three different problems with
    three different fixes, and collapsing them into a count is how an afternoon
    gets spent on the wrong one.
    """
    _steward(db, payload.learner_id, x_admin_token)
    actor = _actor(db.get(Learner, payload.learner_id) if payload.learner_id else None)

    sent, no_account, no_email, not_sent = [], [], [], []
    for who in dict.fromkeys(p.strip() for p in payload.people if p.strip()):
        person = (
            db.query(Learner)
            .filter((Learner.email.ilike(who)) | (Learner.handle.ilike(who)))
            .first()
        )
        if not person:
            no_account.append(who)
            continue
        if not person.email:
            no_email.append(person.handle)
            continue
        if send_welcome(person, pathways_for(db, person), actor):
            sent.append(person.email)
        else:
            # Mail is off, or the recipient is outside MAIL_ALLOWLIST. Either
            # way nothing left the building, and saying "sent" would be a lie.
            not_sent.append(person.email)

    return {
        "sent": sent,
        "no_account": no_account,
        "no_email_on_account": no_email,
        "not_sent": not_sent,
        "mail_enabled": settings.mail_enabled,
    }


@router.post("/people/{person_id}/deactivate", status_code=204)
def deactivate(
    person_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Take somebody out of the live organisation without erasing their record.

    They keep their history — hours, certificates, completed pathways all stay
    in the reports they already count towards. Deleting the person would rewrite
    last year's figures, which is not what "they left" means.
    """
    _steward(db, learner_id, x_admin_token)
    person = db.get(Learner, person_id)
    if not person:
        return
    person.team_id = None
    person.bu = ""
    person.role = "user"
    db.query(HrBuAssignment).filter_by(hr_id=person.id).delete()
    db.query(BuHeadAssignment).filter_by(head_id=person.id).delete()
    db.commit()
    log.info("governance: %s deactivated at %s", person.handle, dt.datetime.now(dt.timezone.utc))


# --------------------------------------------------------------------------- #
# practices — the métiers inside a unit                                       #
# --------------------------------------------------------------------------- #


class PracticeIn(BaseModel):
    learner_id: int | None = None
    bu_id: int
    name: str
    description: str = ""


@router.post("/practices", status_code=201)
def create_practice(
    payload: PracticeIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _steward(db, payload.learner_id, x_admin_token)
    unit = db.get(BusinessUnit, payload.bu_id)
    if not unit:
        raise HTTPException(status_code=404, detail="BU introuvable.")
    name = payload.name.strip()
    if db.query(Practice).filter(Practice.bu_id == unit.id, Practice.name.ilike(name)).first():
        raise HTTPException(status_code=409, detail=f"« {name} » existe déjà dans {unit.name}.")

    last = (
        db.query(Practice).filter_by(bu_id=unit.id).order_by(Practice.position.desc()).first()
    )
    practice = Practice(
        bu_id=unit.id,
        name=name,
        description=payload.description.strip()[:400],
        position=(last.position + 1) if last else 1,
    )
    db.add(practice)
    db.commit()
    db.refresh(practice)
    return {"id": practice.id, "bu_id": unit.id, "name": practice.name}


class PracticePatch(BaseModel):
    learner_id: int | None = None
    name: str | None = None
    description: str | None = None
    position: int | None = None
    archived: bool | None = None


@router.patch("/practices/{practice_id}")
def update_practice(
    practice_id: int,
    payload: PracticePatch,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Rename, re-order or archive a practice.

    A rename carries its people, exactly as a BU rename does: `learners.practice`
    is a string, so renaming only the registry row would strand everybody under
    a name that no longer exists.
    """
    _steward(db, payload.learner_id, x_admin_token)
    practice = db.get(Practice, practice_id)
    if not practice:
        raise HTTPException(status_code=404, detail="Practice introuvable.")
    unit = db.get(BusinessUnit, practice.bu_id)

    moved = 0
    if payload.name and payload.name.strip() != practice.name:
        new_name = payload.name.strip()
        clash = (
            db.query(Practice)
            .filter(Practice.bu_id == practice.bu_id, Practice.name.ilike(new_name))
            .first()
        )
        if clash and clash.id != practice.id:
            raise HTTPException(status_code=409, detail=f"« {new_name} » existe déjà.")
        moved = (
            db.query(Learner)
            .filter(Learner.practice == practice.name, Learner.bu == (unit.name if unit else ""))
            .update({"practice": new_name}, synchronize_session=False)
        )
        practice.name = new_name

    if payload.description is not None:
        practice.description = payload.description.strip()[:400]
    if payload.position is not None:
        practice.position = payload.position
    if payload.archived is not None:
        practice.archived = payload.archived
    db.commit()
    return {"id": practice.id, "name": practice.name, "people_moved": moved}


@router.delete("/practices/{practice_id}", status_code=204)
def archive_practice(
    practice_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Archive, never delete — a closed practice still owns last year's hours."""
    _steward(db, learner_id, x_admin_token)
    practice = db.get(Practice, practice_id)
    if not practice:
        return
    unit = db.get(BusinessUnit, practice.bu_id)
    staffed = (
        db.query(Learner)
        .filter(Learner.practice == practice.name, Learner.bu == (unit.name if unit else ""))
        .count()
    )
    if staffed:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{staffed} collaborateur(s) sont encore rattachés à « {practice.name} ». "
                "Déplacez-les avant d'archiver."
            ),
        )
    practice.archived = True
    db.commit()
