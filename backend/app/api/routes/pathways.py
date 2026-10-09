"""Pathways — curated, ordered journeys mixing trainings, courses and
certifications (Degreed-style). Step completion is derived from real data:
a training is done when its enrollment is completed, a course when all its
lessons are, a certification when the learner shared it on the earned wall.
"""

import datetime as dt

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.notifier import notify
from app.db.session import get_db
from app.models import content_status
from app.models import (
    Certification,
    Course,
    CourseLessonCompletion,
    EarnedCertificate,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    Learner,
    Pathway,
    PathwayEnrollment,
    PathwayStep,
    Team,
)
from app.schemas.course import lesson_ids as course_lesson_ids
from app.schemas.formation import lesson_ids as formation_lesson_ids

router = APIRouter(prefix="/pathways", tags=["pathways"])


def _is_admin(learner: Learner | None, token: str | None) -> bool:
    if settings.admin_token and token == settings.admin_token:
        return True
    return learner is not None and learner.role in ("admin", "hr", "hr_lead")


def _can_create(learner: Learner | None, token: str | None) -> bool:
    if _is_admin(learner, token):
        return True
    return learner is not None and learner.role in (
        "trainer", "manager", "bu_head",
    )


class StepIn(BaseModel):
    entity_type: str  # formation | course | certification
    entity_id: int
    note: str = ""
    # Mandatory step (counts towards completion and gates what follows) or an
    # optional enrichment the learner may skip.
    required: bool = True
    # A checkpoint: nothing after it unlocks until every required step up to
    # and including it is done.
    milestone: bool = False


class PathwayCreate(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    summary: str = ""
    emoji: str = "🧭"
    mandatory: bool = False
    steps: list[StepIn] = []
    learner_id: int | None = None


class EnrollRequest(BaseModel):
    learner_id: int  # who joins (self-enroll)


class AssignRequest(BaseModel):
    member_ids: list[int] = []
    team_id: int | None = None  # assign to a whole team instead
    due_date: dt.date | None = None
    mandatory: bool = False
    learner_id: int | None = None  # the assigner


def _resolve_step(db: Session, step: PathwayStep) -> dict | None:
    if step.entity_type == "formation":
        f = db.get(Formation, step.entity_id)
        return {"title": f.title, "emoji": f.emoji, "link": f"/formations/{f.id}"} if f else None
    if step.entity_type == "course":
        c = db.get(Course, step.entity_id)
        if not c:
            return None
        link = c.external_url or f"/courses/{c.id}"
        return {"title": c.title, "emoji": c.emoji, "link": link}
    if step.entity_type == "certification":
        cert = db.get(Certification, step.entity_id)
        return {"title": cert.name, "emoji": "🎖️", "link": "/certifications"} if cert else None
    return None


def _step_done(db: Session, step: PathwayStep, learner_id: int) -> bool:
    if step.entity_type == "formation":
        enr = db.query(FormationEnrollment).filter_by(
            formation_id=step.entity_id, learner_id=learner_id
        ).first()
        if enr and enr.status == "completed":
            return True
        f = db.get(Formation, step.entity_id)
        if not f:
            return False
        ids = formation_lesson_ids(f.curriculum)
        if not ids:
            return False
        done = db.query(FormationLessonCompletion).filter_by(
            formation_id=step.entity_id, learner_id=learner_id
        ).count()
        return done >= len(ids)
    if step.entity_type == "course":
        c = db.get(Course, step.entity_id)
        if not c:
            return False
        if c.external_url:
            # The provider reports back now: a Coursera step is done when
            # Coursera says it is. Before this, a pathway built out of provider
            # courses could never be finished.
            from app.core import external_progress

            return external_progress.state(db, c, learner_id)[1]
        ids = course_lesson_ids(c.curriculum)
        if not ids:
            return False
        done = db.query(CourseLessonCompletion).filter_by(
            course_id=step.entity_id, learner_id=learner_id
        ).count()
        return done >= len(ids)
    if step.entity_type == "certification":
        return (
            db.query(EarnedCertificate)
            .filter_by(certification_id=step.entity_id, learner_id=learner_id)
            .first()
            is not None
        )
    return False


def _step_percent(db: Session, step: PathwayStep, learner_id: int) -> int | None:
    """How far through this step the learner is, 0-100.

    None when the step has nothing to measure — a certification is held or it
    is not, and a half-full bar under it would be a lie. A course or a training
    reports the same figure the compliance board does, so a learner and L&D
    never read two different numbers for the same work.
    """
    if step.entity_type == "certification":
        return None
    from app.api.routes.assignments import _progress

    done, total = _progress(db, step.entity_type, step.entity_id, learner_id)
    if not total:
        # A training with no lessons yet, or a course that is only a link out
        # with nothing the provider reports: nothing to draw.
        return None
    return round(100 * done / total)


def _pathway_out(db: Session, p: Pathway, viewer_id: int | None) -> dict:
    steps = (
        db.query(PathwayStep).filter_by(pathway_id=p.id).order_by(PathwayStep.position).all()
    )
    resolved = []
    done_count = 0
    required_total = 0
    required_done = 0
    # Milestone gating: walk the steps in order and keep the position of the
    # first unmet checkpoint. Everything after it is locked, and the reason
    # travels with the step so the UI can explain the block instead of just
    # greying it out. With no milestones this loop locks nothing, which is
    # exactly the old free-order behaviour.
    blocked_from: int | None = None
    blocked_by: str = ""
    pending_required: list[str] = []

    for s in steps:
        info = _resolve_step(db, s)
        if not info:
            continue
        done = bool(viewer_id and _step_done(db, s, viewer_id))
        done_count += int(done)
        if s.required:
            required_total += 1
            required_done += int(done)

        locked = blocked_from is not None
        resolved.append({
            "id": s.id,
            "position": s.position,
            "entity_type": s.entity_type,
            "entity_id": s.entity_id,
            "note": s.note,
            "required": s.required,
            "milestone": s.milestone,
            "done": done,
            # None = nothing to measure; the UI then draws no bar.
            "percent": 100 if done else (_step_percent(db, s, viewer_id) if viewer_id else None),
            "locked": locked,
            "locked_by": blocked_by if locked else "",
            **info,
        })

        if blocked_from is None:
            if s.required and not done:
                pending_required.append(info["title"])
            if s.milestone and pending_required:
                # The checkpoint itself stays open — it's the step AFTER it
                # that waits on the unfinished required work.
                blocked_from = s.position + 1
                blocked_by = pending_required[0]
    enrollment = None
    if viewer_id:
        enrollment = db.query(PathwayEnrollment).filter_by(
            pathway_id=p.id, learner_id=viewer_id
        ).first()
    enrolled_count = db.query(PathwayEnrollment).filter_by(pathway_id=p.id).count()
    return {
        "id": p.id,
        "title": p.title,
        "summary": p.summary,
        "emoji": p.emoji,
        "created_by_name": p.created_by_name,
        "status": p.status,
        "mandatory": p.mandatory,
        "steps": resolved,
        "step_count": len(resolved),
        "required_count": required_total,
        "required_done": required_done if viewer_id else 0,
        "optional_count": len(resolved) - required_total,
        "done_count": done_count if viewer_id else 0,
        # Progress tracks the *required* spine — optional enrichment shouldn't
        # make a mandatory pathway look finished when it isn't.
        "percent": (
            round(100 * required_done / required_total)
            if required_total and viewer_id
            else (round(100 * done_count / len(resolved)) if resolved and viewer_id else 0)
        ),
        "complete": bool(viewer_id and required_total and required_done == required_total),
        "locked_from": blocked_from,
        "locked_by": blocked_by,
        "enrolled": enrollment is not None,
        "due_date": enrollment.due_date if enrollment else None,
        # The *assignment* is compliance. Distinct from the pathway-level
        # `mandatory` above: a pathway can be required of everyone it is
        # given to, or merely suggested to one team and required of another.
        # Both used to be serialised as "mandatory" — same dict, so the
        # second silently won.
        "assigned_mandatory": bool(enrollment.mandatory) if enrollment else False,
        "assigned_by": enrollment.assigned_by if enrollment else "",
        "enrolled_count": enrolled_count,
    }


def lock_reason(db: Session, learner_id: int | None, entity_type: str, entity_id: int) -> str | None:
    """Why this learner may not progress on this content yet, or None.

    The milestone lock used to exist only in the pathway view: it was worked out
    when the pathway page rendered, and nothing else consulted it, so the same
    training opened from the catalogue or a bookmarked URL progressed freely.
    The content routes now ask here before recording progress.

    Only pathways the learner is enrolled in count. A training that sits behind
    a milestone in someone else's pathway is not locked for everybody — the
    lock belongs to the journey, not to the content.
    """
    if not learner_id:
        return None
    enrolled = {
        row[0]
        for row in db.query(PathwayEnrollment.pathway_id).filter_by(learner_id=learner_id).all()
    }
    if not enrolled:
        return None
    containing = {
        row[0]
        for row in db.query(PathwayStep.pathway_id)
        .filter_by(entity_type=entity_type, entity_id=entity_id)
        .all()
    } & enrolled
    for pathway in db.query(Pathway).filter(Pathway.id.in_(containing or {0})).all():
        for step in _pathway_out(db, pathway, learner_id)["steps"]:
            if (
                step["entity_type"] == entity_type
                and step["entity_id"] == entity_id
                and step["locked"]
            ):
                return (
                    f"Locked in the pathway \u201c{pathway.title}\u201d: finish "
                    f"\u201c{step['locked_by']}\u201d first."
                )
    return None


@router.get("")
def list_pathways(learner_id: int | None = None, db: Session = Depends(get_db)):
    return [
        _pathway_out(db, p, learner_id)
        for p in db.query(Pathway).filter(Pathway.status.in_(content_status.VISIBLE)).order_by(Pathway.id.desc())
    ]


@router.post("", status_code=201)
def create_pathway(
    payload: PathwayCreate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_create(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only trainers, leads, managers, HR or admins can create pathways.")
    p = Pathway(
        title=payload.title.strip(),
        summary=payload.summary.strip(),
        emoji=payload.emoji or "🧭",
        mandatory=payload.mandatory,
        created_by_id=viewer.id if viewer else None,
        created_by_name=(viewer.name or viewer.handle) if viewer else "admin",
    )
    db.add(p)
    db.flush()
    for i, s in enumerate(payload.steps):
        db.add(PathwayStep(
            pathway_id=p.id, position=i,
            entity_type=s.entity_type, entity_id=s.entity_id, note=s.note.strip(),
            required=s.required, milestone=s.milestone,
        ))
    db.commit()
    return _pathway_out(db, p, payload.learner_id)


@router.put("/{pathway_id}")
def update_pathway(
    pathway_id: int,
    payload: PathwayCreate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Rewrite a pathway's metadata and its ordered steps.

    Steps are replaced wholesale — the ordering, the required/optional split
    and the milestones only make sense as one coherent list, so editing them
    piecemeal would let a half-applied update gate the wrong content."""
    p = db.get(Pathway, pathway_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pathway not found")
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not (_is_admin(viewer, x_admin_token) or (viewer and p.created_by_id == viewer.id)):
        raise HTTPException(status_code=403, detail="Only the creator, HR or an admin can edit this pathway.")

    p.title = payload.title.strip()
    p.summary = payload.summary.strip()
    p.emoji = payload.emoji or "🧭"
    p.mandatory = payload.mandatory

    db.query(PathwayStep).filter_by(pathway_id=p.id).delete()
    for i, s in enumerate(payload.steps):
        db.add(PathwayStep(
            pathway_id=p.id, position=i,
            entity_type=s.entity_type, entity_id=s.entity_id, note=s.note.strip(),
            required=s.required, milestone=s.milestone,
        ))
    db.commit()
    return _pathway_out(db, p, payload.learner_id)


@router.delete("/{pathway_id}", status_code=204)
def delete_pathway(
    pathway_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    p = db.get(Pathway, pathway_id)
    if not p:
        return
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not (_is_admin(viewer, x_admin_token) or (viewer and p.created_by_id == viewer.id)):
        raise HTTPException(status_code=403, detail="Only the creator, HR or an admin can delete this pathway.")
    db.delete(p)
    db.commit()


@router.post("/{pathway_id}/enroll")
def enroll(pathway_id: int, payload: EnrollRequest, db: Session = Depends(get_db)):
    p = db.get(Pathway, pathway_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pathway not found")
    exists = db.query(PathwayEnrollment).filter_by(
        pathway_id=pathway_id, learner_id=payload.learner_id
    ).first()
    if not exists:
        db.add(PathwayEnrollment(pathway_id=pathway_id, learner_id=payload.learner_id))
        db.commit()
    return {"enrolled": True}


@router.post("/{pathway_id}/assign")
def assign(
    pathway_id: int,
    payload: AssignRequest,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Lead/manager/HR assigns the pathway to members or a whole team."""
    p = db.get(Pathway, pathway_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pathway not found")
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None

    targets: list[Learner] = []
    if payload.team_id:
        team = db.get(Team, payload.team_id)
        if not team:
            raise HTTPException(status_code=404, detail="Team not found")
        is_overseer = viewer is not None and viewer.id in (team.lead_id, team.manager_id)
        if not (is_overseer or _is_admin(viewer, x_admin_token)):
            raise HTTPException(status_code=403, detail="Only the team's lead/manager, HR or an admin can assign.")
        targets = db.query(Learner).filter(Learner.team_id == team.id).all()
    for mid in payload.member_ids:
        m = db.get(Learner, mid)
        if not m:
            continue
        team = db.get(Team, m.team_id) if m.team_id else None
        is_overseer = viewer is not None and team is not None and viewer.id in (team.lead_id, team.manager_id)
        if not (is_overseer or _is_admin(viewer, x_admin_token)):
            continue
        targets.append(m)

    assigner = (viewer.name or viewer.handle) if viewer else "admin"
    assigned, skipped = [], []
    for m in targets:
        if db.query(PathwayEnrollment).filter_by(pathway_id=p.id, learner_id=m.id).first():
            skipped.append({"handle": m.handle, "reason": "already enrolled"})
            continue
        db.add(PathwayEnrollment(
            pathway_id=p.id, learner_id=m.id, assigned_by=assigner, due_date=payload.due_date,
            mandatory=payload.mandatory,
        ))
        assigned.append(m.handle)
        due = f" — due {payload.due_date.strftime('%d %b')}" if payload.due_date else ""
        obligation = "Obligatoire — " if payload.mandatory else ""
        notify(
            db, [m.id],
            kind="assignment",
            title=f"{obligation}Pathway assigned: {p.title}",
            body=f"{assigner} assigned you this learning path{due}.",
            link="/pathways",
        )
    db.commit()

    # The team's manager hears once, with the names — the same rule the
    # campaign route follows. Assigning a mandatory pathway and telling nobody
    # but the learner is how a deadline arrives unnoticed by the one person
    # who is asked about it later.
    from app.core import manager_alerts

    told = manager_alerts.announce_campaign(
        db,
        {m.id: [(p.title, f"/pathways/{p.id}")] for m in targets if m.handle in assigned},
        by=assigner,
        due=payload.due_date,
        mandatory=payload.mandatory,
    ) if assigned else 0

    return {"assigned": assigned, "skipped": skipped, "managers_told": told}
