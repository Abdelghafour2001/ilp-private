"""The approval board — one queue, one history, both sides of the decision.

A manager's approvals were previously scattered: assets sat in the assets page,
logged learning in the skills page, and there was nowhere at all to ask for a
training. Worse, a decline left no trace: an asset went back to "rejected" and
a learning record simply stayed unverified, so nobody could tell "not looked at
yet" from "looked at and refused, for this reason".

This route pulls the three streams into one board:

* **To decide** — everything waiting on this person, oldest first.
* **History** — what they approved and, importantly, what they declined and why.

The requester sees the same decisions from their side, so "why was this
refused?" is answerable without asking anyone.

Scope is by relationship, not by role: a manager decides for their own team, an
HR lead or admin can act anywhere. That mirrors how the rest of the app scopes
overseers and keeps one manager out of another's queue.
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.notifier import notify
from app.core.rbac import bu_head_for, can_curate, is_people_admin
from app.db.session import get_db
from app.models import content_status
from app.models import (
    ApprovalStep,
    Asset,
    Course,
    Formation,
    Learner,
    LearningRecord,
    Team,
    TrainingRequest,
)

router = APIRouter(prefix="/approvals", tags=["approvals"])

KINDS = ("training_request", "asset", "learning_record", "course")


# --------------------------------------------------------------------------- #
# who may decide for whom                                                     #
# --------------------------------------------------------------------------- #


def build_chain(db: Session, request: TrainingRequest, requester: Learner) -> list[ApprovalStep]:
    """The approvers a request has to pass, in order.

    Stage 1 is the N+1 — the manager of the requester's team. Stage 2 is the
    head of their BU, who owns the budget the manager is spending. Both steps
    are created up front so the requester sees the whole path in front of their
    ask rather than discovering a second approver after the first says yes.

    A stage whose approver cannot be resolved is created with `approver_id` NULL
    and stays pending. That is deliberate: a BU with no head means the request is
    stuck and somebody needs to appoint one, which is worth surfacing. Skipping
    the stage would silently approve a spend nobody signed off.
    """
    team = db.get(Team, requester.team_id) if requester.team_id else None
    manager = db.get(Learner, team.manager_id) if team and team.manager_id else None
    head = bu_head_for(db, requester.bu or "")

    steps: list[ApprovalStep] = []
    for position, (stage, approver) in enumerate(
        (("manager", manager), ("bu_head", head)), start=1
    ):
        # Don't ask the same person twice: someone who heads the BU *and*
        # manages the team decides once, which is what would happen in the room.
        if approver is not None and any(
            st.approver_id == approver.id for st in steps
        ):
            continue
        steps.append(
            ApprovalStep(
                request_id=request.id,
                position=position,
                stage=stage,
                approver_id=approver.id if approver else None,
                approver_name=(approver.name or approver.handle) if approver else "",
            )
        )
    # Re-number after any skip so positions stay 1..n and the unique constraint
    # on (request_id, position) holds.
    for index, step in enumerate(steps, start=1):
        step.position = index
        db.add(step)
    return steps


def current_step(request: TrainingRequest) -> ApprovalStep | None:
    """The stage a request is waiting on, or None when it is finished."""
    return next((st for st in request.steps if st.status == "pending"), None)


def _may_decide_step(db: Session, viewer: Learner, step: ApprovalStep | None) -> bool:
    """Whether this viewer can take the stage in front of them.

    HR and admins can act on any stage — they unblock chains, which is the whole
    reason they are above it. Everyone else must be the named approver: a
    manager cannot reach past their stage into the BU head's, and a BU head
    cannot decide before the manager has.
    """
    if step is None:
        return False
    if is_people_admin(viewer):
        return True
    return step.approver_id == viewer.id


def _oversees(db: Session, viewer: Learner | None, subject_id: int | None) -> bool:
    """True when `viewer` is the manager of `subject`'s team."""
    if viewer is None or subject_id is None:
        return False
    if is_people_admin(viewer):
        return True
    subject = db.get(Learner, subject_id)
    if not subject or not subject.team_id:
        return False
    team = db.get(Team, subject.team_id)
    return team is not None and viewer.id in (team.manager_id, team.lead_id)


def _my_people(db: Session, viewer: Learner) -> set[int] | None:
    """Learner ids this viewer decides for. None = everyone."""
    if is_people_admin(viewer):
        return None
    teams = (
        db.query(Team)
        .filter((Team.manager_id == viewer.id) | (Team.lead_id == viewer.id))
        .all()
    )
    if not teams:
        return set()
    ids = {t.id for t in teams}
    return {
        row[0]
        for row in db.query(Learner.id).filter(Learner.team_id.in_(ids)).all()
    }


def _person(db: Session, learner_id: int | None) -> dict:
    l = db.get(Learner, learner_id) if learner_id else None
    return {
        "id": l.id if l else None,
        "handle": l.handle if l else "",
        "name": (l.name or l.handle) if l else "",
    }


# --------------------------------------------------------------------------- #
# shaping                                                                     #
# --------------------------------------------------------------------------- #


STAGE_LABELS = {"manager": "Manager (N+1)", "bu_head": "Responsable de BU"}


def _step_out(step: ApprovalStep) -> dict:
    return {
        "position": step.position,
        "stage": step.stage,
        "stage_label": STAGE_LABELS.get(step.stage, step.stage),
        "approver": step.approver_name,
        "approver_id": step.approver_id,
        # No approver and still pending means nobody holds the job — the request
        # is blocked, not merely waiting, and the UI says so.
        "unassigned": step.approver_id is None and step.status == "pending",
        "status": step.status,
        "note": step.note,
        "decided_at": step.decided_at,
    }


def _request_item(db: Session, r: TrainingRequest) -> dict:
    """One request, as its approver sees it."""
    step = current_step(r)
    return {
        "kind": "training_request",
        "id": r.id,
        "title": r.title,
        "detail": r.reason,
        "requester": _person(db, r.learner_id),
        "status": r.status,
        "chain": [_step_out(st) for st in r.steps],
        "awaiting": _step_out(step) if step else None,
        "decided_by": r.decided_by_name,
        "decision_note": r.decision_note,
        "decided_at": r.decided_at,
        "created_at": r.created_at,
        "link": (
            f"/formations/{r.formation_id}" if r.formation_id
            else f"/courses/{r.course_id}" if r.course_id else "/formations"
        ),
    }


def _asset_item(db: Session, a: Asset) -> dict:
    status = {"pending": "pending", "approved": "approved", "rejected": "declined"}.get(
        a.status, a.status
    )
    return {
        "kind": "asset",
        "id": a.id,
        "title": a.title,
        "detail": a.summary,
        "requester": _person(db, a.learner_id),
        "status": status,
        "decided_by": a.reviewed_by or "",
        "decision_note": a.review_note or "",
        "decided_at": a.reviewed_at,
        "created_at": a.created_at,
        "link": f"/assets/{a.id}",
    }


def _course_item(db: Session, c: Course) -> dict:
    """A course waiting to join the catalogue.

    Unlike the other three, this one is not about a person — it is about
    content. It still belongs in the same queue, because the reviewer is doing
    the same job: reading something and saying yes or no with a reason.
    """
    status = {
        content_status.PENDING: "pending",
        content_status.PUBLISHED: "approved",
        content_status.DRAFT: "declined",
    }.get(c.status, c.status)
    return {
        "kind": "course",
        "id": c.id,
        "title": c.title,
        "detail": c.summary,
        "requester": _person(db, c.learner_id),
        "status": status,
        "decided_by": c.reviewed_by or "",
        "decision_note": c.review_note or "",
        "decided_at": c.reviewed_at,
        "created_at": c.created_at,
        "link": f"/courses/{c.id}",
    }


def _record_item(db: Session, r: LearningRecord) -> dict:
    return {
        "kind": "learning_record",
        "id": r.id,
        "title": r.title,
        "detail": f"{r.kind} · {round(r.minutes / 60, 1)} h",
        "requester": _person(db, r.learner_id),
        "status": {"verified": "approved"}.get(r.review_status, r.review_status),
        "decided_by": r.verified_by_name,
        "decision_note": r.review_note,
        "decided_at": r.reviewed_at,
        "created_at": r.created_at,
        "link": "/skills",
        # Declared hours count whatever the reviewer says; verification is a
        # quality signal, not a gate. Say so on the card.
        "advisory": True,
    }


# --------------------------------------------------------------------------- #
# the board                                                                   #
# --------------------------------------------------------------------------- #


@router.get("/inbox")
def inbox(learner_id: int, db: Session = Depends(get_db)):
    """Everything waiting on this person, plus what they have already decided."""
    viewer = db.get(Learner, learner_id)
    if not viewer:
        raise HTTPException(status_code=404, detail="Learner not found")

    people = _my_people(db, viewer)
    heads_a_stage = (
        db.query(ApprovalStep.id).filter(ApprovalStep.approver_id == viewer.id).first()
        is not None
    )
    # A BU head may manage no team at all and still have a queue: their
    # authority comes from the chain, not from team membership.
    if people is not None and not people and not heads_a_stage:
        return {
            "can_decide": False,
            "scope": "none",
            "pending": [],
            "history": [],
            "counts": {"pending": 0, "approved": 0, "declined": 0},
        }
    everyone = people is None

    def mine(query, column):
        return query if everyone else query.filter(column.in_(people))

    # Requests follow the chain, not the team: a BU head sees a request the
    # moment the manager has passed it up, even though the requester is not in a
    # team they manage. Anything still on someone else's stage stays out of the
    # queue — a queue that shows what you cannot act on is noise.
    if everyone:
        requests = db.query(TrainingRequest).all()
    else:
        mine_ids = {
            row[0]
            for row in db.query(ApprovalStep.request_id)
            .filter(ApprovalStep.approver_id == viewer.id)
            .all()
        }
        requests = [
            r
            for r in db.query(TrainingRequest).filter(TrainingRequest.id.in_(mine_ids or {0})).all()
            if r.status != "pending" or (current_step(r) or ApprovalStep()).approver_id == viewer.id
        ]
    assets = mine(
        db.query(Asset).filter(Asset.learner_id.isnot(None)), Asset.learner_id
    ).all()
    records = mine(db.query(LearningRecord), LearningRecord.learner_id).all()
    # Courses are curated, not line-managed: a trainer reviews material from
    # anywhere in the company, not only from the people they manage. So this one
    # is scoped by the curator role rather than by the team.
    courses = (
        db.query(Course)
        .filter(Course.status.in_((content_status.PENDING, content_status.PUBLISHED)))
        .filter(Course.reviewed_at.isnot(None) | (Course.status == content_status.PENDING))
        .all()
        if can_curate(viewer)
        else []
    )

    items = (
        [_request_item(db, r) for r in requests]
        + [_asset_item(db, a) for a in assets]
        + [_record_item(db, r) for r in records]
        + [_course_item(db, c) for c in courses]
    )

    pending = [i for i in items if i["status"] == "pending"]
    history = [i for i in items if i["status"] in ("approved", "declined")]
    # Oldest waiting first — a queue people work through, not a feed.
    pending.sort(key=lambda i: i["created_at"])
    history.sort(key=lambda i: i["decided_at"] or i["created_at"], reverse=True)

    return {
        "can_decide": True,
        "scope": "org" if everyone else "team",
        "pending": pending,
        "history": history[:80],
        "counts": {
            "pending": len(pending),
            "approved": sum(1 for i in history if i["status"] == "approved"),
            "declined": sum(1 for i in history if i["status"] == "declined"),
        },
    }


class DecisionIn(BaseModel):
    learner_id: int  # the decider
    decision: str  # approved | declined
    note: str = ""


@router.post("/{kind}/{item_id}/decide")
def decide(kind: str, item_id: int, payload: DecisionIn, db: Session = Depends(get_db)):
    """Approve or decline one item.

    A decline requires a note. "No" without a reason is not something the
    requester can act on, and it is the single most common complaint about
    approval workflows.
    """
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of: {', '.join(KINDS)}")
    if payload.decision not in ("approved", "declined"):
        raise HTTPException(status_code=400, detail="decision must be approved or declined.")
    if payload.decision == "declined" and not payload.note.strip():
        raise HTTPException(
            status_code=400, detail="Give a reason when declining — the requester needs it."
        )

    viewer = db.get(Learner, payload.learner_id)
    if not viewer:
        raise HTTPException(status_code=404, detail="Learner not found")

    now = dt.datetime.now(dt.timezone.utc)
    who = viewer.name or viewer.handle
    note = payload.note.strip()[:600]
    approved = payload.decision == "approved"

    if kind == "training_request":
        row = db.get(TrainingRequest, item_id)
        if not row:
            raise HTTPException(status_code=404, detail="Request not found")
        subject_id = row.learner_id
    elif kind == "asset":
        row = db.get(Asset, item_id)
        if not row:
            raise HTTPException(status_code=404, detail="Asset not found")
        subject_id = row.learner_id
    elif kind == "course":
        row = db.get(Course, item_id)
        if not row:
            raise HTTPException(status_code=404, detail="Course not found")
        subject_id = row.learner_id
    else:
        row = db.get(LearningRecord, item_id)
        if not row:
            raise HTTPException(status_code=404, detail="Record not found")
        subject_id = row.learner_id

    step = current_step(row) if kind == "training_request" else None
    if kind == "training_request":
        if row.status != "pending":
            raise HTTPException(status_code=409, detail="This request is already decided.")
        if not _may_decide_step(db, viewer, step):
            waiting = step.approver_name if step and step.approver_name else "personne"
            raise HTTPException(
                status_code=403,
                detail=f"This request is waiting on {waiting}, not you.",
            )
    elif kind == "course":
        if row.status != content_status.PENDING:
            raise HTTPException(status_code=409, detail=f"Course is {row.status}, not awaiting review.")
        if not can_curate(viewer):
            raise HTTPException(
                status_code=403,
                detail="Only a trainer, manager, BU head, HR or an admin can review a course.",
            )
    elif not _oversees(db, viewer, subject_id):
        raise HTTPException(
            status_code=403,
            detail="Only this person's manager, HR or an admin can decide this.",
        )
    if viewer.id == subject_id:
        raise HTTPException(status_code=400, detail="You cannot decide on your own request.")

    if kind == "training_request":
        assert step is not None
        step.status = payload.decision
        step.note, step.decided_at = note, now
        # Record who actually took the stage, which may be an HR override rather
        # than the named approver.
        step.approver_id, step.approver_name = viewer.id, who

        remaining = current_step(row)
        if approved and remaining is not None:
            # Passed up, not finished. The request stays pending and the next
            # approver is told, so it does not sit in a queue nobody is watching.
            if remaining.approver_id:
                notify(
                    db,
                    [remaining.approver_id],
                    kind="approval",
                    title=f"À valider — {row.title}",
                    body=f"Validé par {who}. En attente de votre décision.",
                    link="/approvals",
                )
            notify(
                db,
                [row.learner_id],
                kind="approval",
                title=f"⏫ {row.title} — transmis",
                body=(
                    f"{who} a validé. En attente de "
                    + (remaining.approver_name or "la nomination d'un responsable de BU")
                    + "."
                ),
                link="/approvals",
            )
            db.commit()
            return {
                "status": "pending",
                "decided_by": who,
                "advanced_to": _step_out(remaining),
            }

        row.status = payload.decision
        row.decided_by_id, row.decided_by_name = viewer.id, who
        row.decision_note, row.decided_at = note, now
        if not approved:
            # One "no" ends the chain. Later stages are marked skipped rather
            # than left pending, so the history reads as a finished path.
            for later in row.steps:
                if later.status == "pending":
                    later.status = "skipped"
        title = row.title
    elif kind == "asset":
        row.status = "approved" if approved else "rejected"
        row.reviewed_by, row.review_note, row.reviewed_at = who, note, now
        title = row.title
    elif kind == "course":
        # A rejected course goes back to draft rather than to a dead state: the
        # author is meant to fix it and submit again, which is the point of the
        # note they were just given.
        row.status = content_status.PUBLISHED if approved else content_status.DRAFT
        row.reviewed_by, row.review_note, row.reviewed_at = who, note, now
        title = row.title
    else:
        row.review_status = "verified" if approved else "declined"
        row.verified_by_id = viewer.id if approved else None
        row.verified_by_name = who
        row.review_note, row.reviewed_at = note, now
        title = row.title

    verb = "approuvé" if approved else "refusé"
    notify(
        db,
        [subject_id],
        kind="approval",
        title=f"{'✅' if approved else '↩️'} {title} — {verb}",
        body=(note or f"Décidé par {who}."),
        link="/approvals",
    )
    db.commit()
    return {"status": payload.decision, "decided_by": who}


# --------------------------------------------------------------------------- #
# the requester's side                                                        #
# --------------------------------------------------------------------------- #


class RequestIn(BaseModel):
    learner_id: int
    formation_id: int | None = None
    course_id: int | None = None
    reason: str = Field(default="", max_length=2000)


@router.get("/mine")
def my_items(learner_id: int, db: Session = Depends(get_db)):
    """What I asked for and what I submitted, with the outcome and the reason."""
    viewer = db.get(Learner, learner_id)
    if not viewer:
        raise HTTPException(status_code=404, detail="Learner not found")

    items = (
        [
            _request_item(db, r)
            for r in db.query(TrainingRequest).filter_by(learner_id=viewer.id)
        ]
        + [
            _asset_item(db, a)
            for a in db.query(Asset).filter_by(learner_id=viewer.id)
        ]
        + [
            _record_item(db, r)
            for r in db.query(LearningRecord).filter_by(learner_id=viewer.id)
        ]
    )
    items.sort(key=lambda i: i["created_at"], reverse=True)

    team = db.get(Team, viewer.team_id) if viewer.team_id else None
    approver = None
    if team and team.manager_id:
        approver = _person(db, team.manager_id)

    return {
        "items": items,
        "approver": approver,
        "counts": {
            "pending": sum(1 for i in items if i["status"] == "pending"),
            "approved": sum(1 for i in items if i["status"] == "approved"),
            "declined": sum(1 for i in items if i["status"] == "declined"),
        },
    }


@router.post("/requests", status_code=201)
def create_request(payload: RequestIn, db: Session = Depends(get_db)):
    """Ask to take a training or course."""
    learner = db.get(Learner, payload.learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    if not payload.formation_id and not payload.course_id:
        raise HTTPException(status_code=400, detail="Pick a training or a course.")

    formation = db.get(Formation, payload.formation_id) if payload.formation_id else None
    course = db.get(Course, payload.course_id) if payload.course_id else None
    target = formation or course
    if not target:
        raise HTTPException(status_code=404, detail="That training or course no longer exists.")

    existing = (
        db.query(TrainingRequest)
        .filter_by(
            learner_id=learner.id,
            formation_id=payload.formation_id,
            course_id=payload.course_id,
            status="pending",
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="You already have a pending request for this.")

    row = TrainingRequest(
        learner_id=learner.id,
        formation_id=payload.formation_id,
        course_id=payload.course_id,
        title=target.title,
        reason=payload.reason.strip(),
    )
    db.add(row)
    db.flush()  # need the id before the chain can reference it

    steps = build_chain(db, row, learner)

    # Only the first approver is told. Telling the whole chain up front turns an
    # approval queue into a mailing list, and the BU head cannot act yet anyway.
    first = steps[0] if steps else None
    if first and first.approver_id:
        notify(
            db,
            [first.approver_id],
            kind="approval",
            title=f"Demande de formation — {learner.name or learner.handle}",
            body=target.title,
            link="/approvals",
        )
    db.commit()
    db.refresh(row)
    return _request_item(db, row)


@router.delete("/requests/{request_id}", status_code=204)
def withdraw_request(request_id: int, learner_id: int, db: Session = Depends(get_db)):
    """Withdraw a request you raised, while it is still pending."""
    row = db.get(TrainingRequest, request_id)
    if not row:
        return
    if row.learner_id != learner_id:
        raise HTTPException(status_code=403, detail="Only the requester can withdraw this.")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="This request has already been decided.")
    db.delete(row)
    db.commit()
