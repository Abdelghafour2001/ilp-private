"""Giving people work, and following what happens to it.

One door for three kinds of thing. Courses had an assign endpoint, trainings
had a trainer-only invite, pathways could only be pushed at a whole team — so
"L&D assigns this to these people by Friday" was three different operations
with three different rules, and only one of them produced a row anybody could
report on.

Assigning to a team fans out to one row per member. A team is a convenience for
the person doing the assigning; the obligation belongs to the people, and it
should not disappear when somebody moves team.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email_template import Button, render_email
from app.core.i18n import tr
from app.core.mailer import send_email
from app.core.notifier import notify
from app.core.rbac import can_curate, can_read_reporting, oversight_scope
from app.db.session import get_db
from app.models import (
    AssessmentAttempt,
    Course,
    CourseAssignment,
    CourseLessonCompletion,
    ExternalEnrollment,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    Learner,
    Pathway,
    PathwayEnrollment,
    PathwayStep,
    Team,
)
from app.core import external_progress
from app.schemas.course import lesson_ids as course_lesson_ids
from app.schemas.formation import lesson_ids as formation_lesson_ids

router = APIRouter(prefix="/assignments", tags=["assignments"])

KINDS = ("course", "formation", "pathway")


class AssignIn(BaseModel):
    entity_type: str
    entity_id: int
    # Either or both: named people, and everyone currently in a team.
    learner_ids: list[int] = []
    team_id: int | None = None
    mandatory: bool = True
    due_date: dt.date | None = None
    note: str = ""
    learner_id: int | None = None  # the assigner


def _title(db: Session, kind: str, entity_id: int) -> str:
    model = {"course": Course, "formation": Formation, "pathway": Pathway}[kind]
    row = db.get(model, entity_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"No {kind} with id {entity_id}.")
    return row.title


def _link(kind: str, entity_id: int) -> str:
    return {"course": "/courses", "formation": "/formations", "pathway": "/pathways"}[kind] + f"/{entity_id}"


@router.post("", status_code=201)
def assign(
    payload: AssignIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Hand a course, training or pathway to people, and tell them."""
    if payload.entity_type not in KINDS:
        raise HTTPException(status_code=400, detail=f"entity_type must be one of {KINDS}")
    actor = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not can_curate(actor, x_admin_token):
        raise HTTPException(
            status_code=403,
            detail="Only a trainer, manager, BU head, HR or an admin can assign work.",
        )

    title = _title(db, payload.entity_type, payload.entity_id)
    targets = {int(i) for i in payload.learner_ids}
    team = db.get(Team, payload.team_id) if payload.team_id else None
    if payload.team_id and not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if team:
        targets |= {
            row[0] for row in db.query(Learner.id).filter(Learner.team_id == team.id).all()
        }
    if not targets:
        raise HTTPException(status_code=400, detail="Name at least one person, or a team.")

    by = (actor.name or actor.handle) if actor else "L&D"
    created, already = [], []
    for learner in db.query(Learner).filter(Learner.id.in_(targets)).all():
        existing = (
            db.query(CourseAssignment)
            .filter_by(
                entity_type=payload.entity_type,
                entity_id=payload.entity_id,
                learner_id=learner.id,
            )
            .first()
        )
        if existing:
            # Re-assigning is how a deadline moves, so update rather than refuse.
            existing.mandatory = payload.mandatory
            existing.due_date = payload.due_date
            existing.note = payload.note[:400]
            already.append(learner.handle)
            continue

        db.add(
            CourseAssignment(
                entity_type=payload.entity_type,
                entity_id=payload.entity_id,
                learner_id=learner.id,
                mandatory=payload.mandatory,
                due_date=payload.due_date,
                assigned_by=by,
                note=payload.note[:400],
                via_team_id=team.id if team else None,
            )
        )
        # A pathway needs the same door. Without the enrolment the person is
        # told to walk a journey that does not appear on their own pathway
        # page, and their progress along it is never recorded.
        if payload.entity_type == "pathway":
            walking = (
                db.query(PathwayEnrollment)
                .filter_by(pathway_id=payload.entity_id, learner_id=learner.id)
                .first()
            )
            if not walking:
                db.add(
                    PathwayEnrollment(
                        pathway_id=payload.entity_id,
                        learner_id=learner.id,
                        assigned_by=by,
                        mandatory=payload.mandatory,
                        due_date=payload.due_date,
                    )
                )
        # A training also has to be joinable: an assignment nobody is enrolled
        # on is a to-do item with no door into the content.
        if payload.entity_type == "formation":
            enrolled = (
                db.query(FormationEnrollment)
                .filter_by(formation_id=payload.entity_id, learner_id=learner.id)
                .first()
            )
            if not enrolled:
                db.add(
                    FormationEnrollment(
                        formation_id=payload.entity_id,
                        learner_id=learner.id,
                        status="invited",
                        invited_by=by,
                    )
                )
        created.append(learner.handle)

    db.commit()

    if created:
        people = db.query(Learner).filter(Learner.handle.in_(created)).all()
        due = payload.due_date.isoformat() if payload.due_date else ""
        notify(
            db,
            [p.id for p in people],
            kind="assignment",
            title=("📌 " if payload.mandatory else "💡 ") + title,
            body=(f"{by} · {due}" if due else by),
            link=_link(payload.entity_type, payload.entity_id),
        )
        link = _link(payload.entity_type, payload.entity_id)
        for person in people:
            if not person.email:
                continue
            blocks: list = [
                ("p", tr(
                    person,
                    "assign.course.body.mandatory" if payload.mandatory else "assign.course.body.optional",
                    who=by, title=title,
                )),
            ]
            if payload.due_date:
                blocks.append(("stats", [(tr(person, "assign.due"), f"{payload.due_date:%d/%m/%Y}")]))
            if payload.note.strip():
                blocks.append(("note", payload.note.strip()))
            html, text = render_email(
                heading=title,
                preheader=tr(person, "assign.course.title", title=title),
                blocks=blocks,
                button=Button(tr(person, "assign.cta"), link),
                footer_note=tr(person, "assign.footer", who=by),
            )
            send_email(person.email, f"[UpSkill] {title}", html, text)

    # And tell their managers. This used to happen only on the campaign route,
    # so work handed out one person at a time — which is most of it — reached
    # the learner and nobody else. A manager cannot chase what they were never
    # told about, and "my team's mandatory work" is the one thing they asked
    # to hear. announce_campaign stays quiet for optional assignments and
    # sends one summary per manager, so this adds no noise.
    from app.core import manager_alerts

    told = manager_alerts.announce_campaign(
        db,
        {p.id: [(title, _link(payload.entity_type, payload.entity_id))] for p in people},
        by=by,
        due=payload.due_date,
        mandatory=payload.mandatory,
    ) if created else 0

    return {
        "assigned": created,
        "updated": already,
        "mandatory": payload.mandatory,
        "due_date": payload.due_date.isoformat() if payload.due_date else None,
        "managers_told": told,
    }


def _provider_enrolled(db: Session, kind: str, entity_id: int, learner_id: int) -> bool | None:
    """Has the provider seen this person on this assignment yet?

    None for anything that is not a provider course — a training or a local
    course has no such notion, and a column of "no" against them would be a
    lie. For a pathway: whether every provider step has been started, because
    the chase list wants "has not signed up for part of it".
    """
    if kind == "course":
        course = db.get(Course, entity_id)
        if not course or not course.external_url:
            return None
        return external_progress.is_enrolled(db, course, learner_id)
    if kind == "pathway":
        steps = db.query(PathwayStep).filter_by(pathway_id=entity_id).all()
        answers = [
            _provider_enrolled(db, s.entity_type, s.entity_id, learner_id)
            for s in steps
            if s.entity_type == "course"
        ]
        real = [a for a in answers if a is not None]
        return all(real) if real else None
    return None


def _progress(db: Session, kind: str, entity_id: int, learner_id: int) -> tuple[int, int]:
    """Steps done and steps total, in whatever that kind counts in."""
    if kind == "course":
        course = db.get(Course, entity_id)
        if not course:
            return 0, 0
        # A catalogue entry done on the provider has no lessons here, so the
        # provider's own percentage is the progress — counted out of 100 rather
        # than as one step out of one. Done/not-done was the first fix (zero
        # lessons reported everybody at 0%) and it was still too coarse: a
        # person 40% through showed on the compliance board as "never started",
        # which is exactly the follow-up conversation that should not happen.
        if course.external_url:
            percent, completed = external_progress.state(db, course, learner_id)
            # Coursera rounds: a finished course can report 97%.
            return (100 if completed else percent), 100
        total = len(course_lesson_ids(course.curriculum))
        done = (
            db.query(CourseLessonCompletion)
            .filter_by(course_id=entity_id, learner_id=learner_id)
            .count()
        )
        return done, total
    if kind == "formation":
        formation = db.get(Formation, entity_id)
        total = len(formation_lesson_ids(formation.curriculum)) if formation else 0
        rows = (
            db.query(FormationLessonCompletion)
            .filter_by(formation_id=entity_id, learner_id=learner_id)
            .all()
        )
        done = {r.lesson_id for r in rows}
        if formation:
            done |= external_progress.done_lesson_ids(db, formation.curriculum, learner_id)
        return len(done), total
    # A pathway is done when its steps are: count the steps, not the lessons.
    steps = db.query(PathwayStep).filter_by(pathway_id=entity_id).all()
    done = 0
    for step in steps:
        if step.entity_type in ("course", "formation"):
            sub_done, sub_total = _progress(db, step.entity_type, step.entity_id, learner_id)
            done += int(sub_total > 0 and sub_done >= sub_total)
    return done, len(steps)


# --------------------------------------------------------------------------- #
# campaigns: several things, to a whole audience, in one act                   #
# --------------------------------------------------------------------------- #


class Audience(BaseModel):
    """Who a campaign is for. Every field adds people; none removes any.

    Four ways of naming a group, because L&D think in all four: these people,
    that team, everybody in a unit, everybody in a practice. They combine, and
    somebody named twice is still one person.
    """

    learner_ids: list[int] = []
    team_ids: list[int] = []
    bus: list[str] = []
    practices: list[str] = []
    # Empty = every role. Narrows whatever the lines above selected.
    roles: list[str] = []


class CampaignItem(BaseModel):
    entity_type: str
    entity_id: int


class CampaignIn(BaseModel):
    items: list[CampaignItem]
    audience: Audience
    mandatory: bool = True
    due_date: dt.date | None = None
    note: str = ""
    learner_id: int | None = None


def _resolve(db: Session, audience: Audience) -> list[Learner]:
    """The people a campaign actually lands on, deduplicated and sorted."""
    found: dict[int, Learner] = {}

    if audience.learner_ids:
        for learner in db.query(Learner).filter(Learner.id.in_(audience.learner_ids)).all():
            found[learner.id] = learner
    if audience.team_ids:
        for learner in db.query(Learner).filter(Learner.team_id.in_(audience.team_ids)).all():
            found[learner.id] = learner
    if audience.bus:
        for learner in db.query(Learner).filter(Learner.bu.in_(audience.bus)).all():
            found[learner.id] = learner
    if audience.practices:
        for learner in db.query(Learner).filter(Learner.practice.in_(audience.practices)).all():
            found[learner.id] = learner

    people = list(found.values())
    if audience.roles:
        people = [p for p in people if p.role in audience.roles]
    return sorted(people, key=lambda p: (p.name or p.handle).lower())


@router.post("/preview")
def preview(
    payload: CampaignIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Who would get what, before anything is sent.

    Assigning mandatory work to a business unit is not an act anybody should
    take blind: it mails a hundred people and puts a deadline on their record.
    This answers the two questions that decide whether to go ahead — exactly
    who is in scope, and which of them already have it.
    """
    actor = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not can_curate(actor, x_admin_token):
        raise HTTPException(status_code=403, detail="Only L&D, HR or a manager can assign work.")
    for item in payload.items:
        if item.entity_type not in KINDS:
            raise HTTPException(status_code=400, detail=f"entity_type must be one of {KINDS}")

    people = _resolve(db, payload.audience)
    ids = [p.id for p in people]

    items = []
    for item in payload.items:
        title = _title(db, item.entity_type, item.entity_id)
        already = {
            row.learner_id
            for row in db.query(CourseAssignment).filter(
                CourseAssignment.entity_type == item.entity_type,
                CourseAssignment.entity_id == item.entity_id,
                CourseAssignment.learner_id.in_(ids or [0]),
            )
        }
        items.append({
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "title": title,
            "new": len([i for i in ids if i not in already]),
            "already": len(already),
        })

    return {
        "people": [
            {
                "learner_id": p.id,
                "name": p.name or p.handle,
                "email": p.email or "",
                "bu": p.bu or "",
                "team_id": p.team_id,
                "role": p.role,
            }
            for p in people
        ],
        "items": items,
        "totals": {
            "people": len(people),
            "items": len(items),
            # Rows that will be written, so the number on the button is the
            # number of obligations about to be created.
            "assignments": sum(i["new"] for i in items),
            "already": sum(i["already"] for i in items),
            "emails": len([p for p in people if p.email]),
            "no_email": [p.name or p.handle for p in people if not p.email][:10],
        },
    }


def _open_the_door(
    db: Session, kind: str, entity_id: int, person: Learner, by: str, payload: "CampaignIn"
) -> None:
    """An assignment nobody is enrolled on is a to-do with no way in."""
    if kind == "formation":
        if not db.query(FormationEnrollment).filter_by(
            formation_id=entity_id, learner_id=person.id
        ).first():
            db.add(FormationEnrollment(
                formation_id=entity_id, learner_id=person.id, status="invited", invited_by=by,
            ))
    elif kind == "pathway":
        if not db.query(PathwayEnrollment).filter_by(
            pathway_id=entity_id, learner_id=person.id
        ).first():
            db.add(PathwayEnrollment(
                pathway_id=entity_id, learner_id=person.id, assigned_by=by,
                mandatory=payload.mandatory, due_date=payload.due_date,
            ))


def _mail_campaign(
    person: Learner, mine: list[tuple[str, str]], by: str, payload: "CampaignIn"
) -> bool:
    """One message per person, listing everything they were just given."""
    intro = "campaign.intro.mandatory" if payload.mandatory else "campaign.intro.optional"
    item_key = "campaign.item.mandatory" if payload.mandatory else "campaign.item.optional"
    blocks: list = [
        ("p", tr(person, intro, who=by)),
        ("list", [tr(person, item_key, title=title) for title, _ in mine]),
    ]
    if payload.due_date:
        blocks.append(("stats", [(tr(person, "assign.due"), f"{payload.due_date:%d/%m/%Y}")]))
    if payload.note.strip():
        blocks.append(("note", payload.note.strip()))

    subject = tr(
        person,
        "campaign.subject.one" if len(mine) == 1 else "campaign.subject.many",
        n=len(mine),
    )
    html, text = render_email(
        heading=subject,
        preheader=tr(person, intro, who=by),
        blocks=blocks,
        button=Button(tr(person, "campaign.cta"), f"{settings.frontend_origin}/history"),
        footer_note=tr(person, "campaign.footer", who=by),
    )
    send_email(person.email, f"[{settings.app_name}] {subject}", html, text)
    return True


@router.post("/campaign", status_code=201)
def campaign(
    payload: CampaignIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Assign several things to a whole audience, and tell everyone once.

    The single-item endpoint mails one message per assignment. Handing somebody
    a five-step induction that way means five emails in a minute, which is how
    a platform teaches people to filter its mail. A campaign sends one message
    per person, listing everything they were given.
    """
    actor = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not can_curate(actor, x_admin_token):
        raise HTTPException(status_code=403, detail="Only L&D, HR or a manager can assign work.")
    if not payload.items:
        raise HTTPException(status_code=400, detail="Pick at least one course, training or pathway.")
    for item in payload.items:
        if item.entity_type not in KINDS:
            raise HTTPException(status_code=400, detail=f"entity_type must be one of {KINDS}")

    people = _resolve(db, payload.audience)
    if not people:
        raise HTTPException(
            status_code=400, detail="That audience is empty — nobody would be assigned."
        )

    by = (actor.name or actor.handle) if actor else "L&D"
    titles: dict[tuple[str, int], str] = {}
    created: dict[int, list[tuple[str, str]]] = {p.id: [] for p in people}
    updated = 0

    for item in payload.items:
        title = _title(db, item.entity_type, item.entity_id)
        titles[(item.entity_type, item.entity_id)] = title
        link = _link(item.entity_type, item.entity_id)
        for person in people:
            existing = (
                db.query(CourseAssignment)
                .filter_by(
                    entity_type=item.entity_type,
                    entity_id=item.entity_id,
                    learner_id=person.id,
                )
                .first()
            )
            if existing:
                # Re-running a campaign is how a deadline moves, so update
                # rather than refuse — and do not mail them about it twice.
                existing.mandatory = payload.mandatory
                existing.due_date = payload.due_date
                existing.note = payload.note[:400]
                updated += 1
                continue

            db.add(
                CourseAssignment(
                    entity_type=item.entity_type,
                    entity_id=item.entity_id,
                    learner_id=person.id,
                    mandatory=payload.mandatory,
                    due_date=payload.due_date,
                    assigned_by=by,
                    note=payload.note[:400],
                )
            )
            _open_the_door(db, item.entity_type, item.entity_id, person, by, payload)
            created[person.id].append((title, link))

    db.commit()

    mailed = 0
    for person in people:
        mine = created[person.id]
        if not mine:
            continue
        notify(
            db,
            [person.id],
            kind="assignment",
            title=("\U0001F4CC " if payload.mandatory else "\U0001F4A1 ")
            + (mine[0][0] if len(mine) == 1 else f"{len(mine)} new items for you"),
            body=(f"{by} \u00b7 {payload.due_date:%d/%m/%Y}" if payload.due_date else by),
            link=mine[0][1] if len(mine) == 1 else "/history",
        )
        if person.email:
            mailed += int(_mail_campaign(person, mine, by, payload))
    db.commit()

    # And their managers, once each, listing their own people — not one message
    # per person, which is how a channel stops being read.
    from app.core import manager_alerts

    managers = manager_alerts.announce_campaign(
        db, created, by, payload.due_date, payload.mandatory
    )

    return {
        "people": len(people),
        "managers_told": managers,
        "assignments": sum(len(v) for v in created.values()),
        "updated": updated,
        "emails": mailed,
        "mandatory": payload.mandatory,
        "due_date": payload.due_date.isoformat() if payload.due_date else None,
        "items": [titles[(i.entity_type, i.entity_id)] for i in payload.items],
    }


class AcceptIn(BaseModel):
    learner_id: int  # who is accepting — L&D, HR or an admin
    note: str = ""


@router.post("/{assignment_id}/accept")
def accept_as_done(assignment_id: int, payload: AcceptIn,
                   x_admin_token: str | None = Header(default=None),
                   db: Session = Depends(get_db)):
    """Close an assignment on evidence the platform cannot see for itself.

    The case this exists for: a Coursera course taken outside the
    organisation's programmes. The enterprise report never carries it, so the
    row would stay open for ever — daily reminders, then overdue, then a
    non-compliance figure — while the certificate sits in the person's learning
    log. Somebody has to be able to look at that and say yes.

    Who may: whoever may assign. Handing work out and closing it are the same
    responsibility, and splitting them would mean a second permission to get
    wrong.
    """
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not can_curate(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="L&D, HR or an admin only.")
    row = db.get(CourseAssignment, assignment_id)
    if not row:
        raise HTTPException(status_code=404, detail="No such assignment.")

    row.accepted_on = dt.date.today()
    row.accepted_by = (viewer.name or viewer.handle) if viewer else "admin token"
    row.accepted_note = payload.note.strip()[:400]
    # The reminders stop with it: chasing somebody for work you have just
    # agreed is done is the behaviour this whole feature exists to end.
    row.last_reminded_on = dt.date.today()
    db.commit()

    learner = db.get(Learner, row.learner_id)
    title = _title(db, row.entity_type, row.entity_id)
    if learner:
        notify(
            db, [learner.id], kind="assignment_accepted",
            title=f"✅ {title}",
            body=tr(learner, "accept.body", who=row.accepted_by),
            link=_link(row.entity_type, row.entity_id),
        )
        # notify() only queues the row; without this the person is never told.
        db.commit()
        _mail_accepted(learner, row, title)
    return _accepted_out(row, title)


def _mail_accepted(learner: Learner, row: CourseAssignment, title: str) -> None:
    """Tell them by email too, not only in the bell.

    The daily reminders arrived by mail, so the message that ends them belongs
    in the same place — otherwise the last thing in their inbox about this is a
    chase, and they have to open the app to find out it is over.
    """
    if not (learner.email and settings.mail_enabled):
        return
    heading = tr(learner, "accept.subject", title=title)
    blocks: list = [
        ("p", tr(learner, "accept.body", who=row.accepted_by)),
    ]
    if row.accepted_note:
        blocks.append(("note", f"{tr(learner, 'accept.evidence')} — {row.accepted_note}"))
    html, text = render_email(
        heading=heading,
        preheader=heading,
        blocks=blocks,
        button=Button(tr(learner, "accept.cta"), f"{settings.frontend_origin}/history"),
        footer_note=tr(
            learner, "accept.footer",
            who=row.accepted_by,
            date=f"{row.accepted_on:%d/%m/%Y}",
        ),
    )
    send_email(learner.email, f"[{settings.app_name}] {heading}", html, text)


@router.delete("/{assignment_id}/accept")
def undo_accept(assignment_id: int, learner_id: int,
                x_admin_token: str | None = Header(default=None),
                db: Session = Depends(get_db)):
    """Undo an acceptance. People press the wrong row."""
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not can_curate(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="L&D, HR or an admin only.")
    row = db.get(CourseAssignment, assignment_id)
    if not row:
        raise HTTPException(status_code=404, detail="No such assignment.")
    row.accepted_on = None
    row.accepted_by = ""
    row.accepted_note = ""
    db.commit()
    return _accepted_out(row, _title(db, row.entity_type, row.entity_id))


def _accepted_out(row: CourseAssignment, title: str) -> dict:
    return {
        "id": row.id,
        "title": title,
        "accepted_on": row.accepted_on.isoformat() if row.accepted_on else None,
        "accepted_by": row.accepted_by,
        "accepted_note": row.accepted_note,
    }


@router.get("/mine")
def mine(learner_id: int, db: Session = Depends(get_db)):
    """What this person has been assigned, newest deadline first.

    The catalogue pages need one answer to "is this mine, and is it still
    owed": `/history` knows about courses and provider records but not about
    pathway assignments, so each page was left either guessing or showing
    nothing. One endpoint, three pages, the same truth on all of them.

    `learner_id` is rewritten from the proven token by the identity
    middleware, so this returns the caller's own assignments and nobody
    else's.
    """
    rows = (
        db.query(CourseAssignment)
        .filter(CourseAssignment.learner_id == learner_id)
        .all()
    )
    out = []
    for row in rows:
        try:
            title = _title(db, row.entity_type, row.entity_id)
        except HTTPException:
            # The content was deleted; the assignment row is stale.
            continue
        done, total = _progress(db, row.entity_type, row.entity_id, learner_id)
        complete = bool(row.accepted_on) or (total > 0 and done >= total)
        out.append({
            "kind": row.entity_type,
            "id": row.entity_id,
            "title": title,
            "link": _link(row.entity_type, row.entity_id),
            "mandatory": row.mandatory,
            "due_date": row.due_date.isoformat() if row.due_date else None,
            "percent": round(100 * done / total) if total else 0,
            "done": complete,
            "accepted": bool(row.accepted_on),
        })
    # Soonest deadline first; undated last, because a date is the only thing
    # that makes one of these more urgent than another.
    out.sort(key=lambda r: (r["due_date"] is None, r["due_date"] or ""))
    return {"items": out}


@router.get("/roster")
def roster(
    entity_type: str,
    entity_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Who already has this one thing, and where each of them got to.

    The same question `/tracking` answers for a whole perimeter, asked about a
    single course, training or pathway — so somebody about to assign it can see
    who has it already instead of handing it out twice.
    """
    if entity_type not in KINDS:
        raise HTTPException(status_code=400, detail=f"entity_type must be one of {KINDS}")
    actor = db.get(Learner, learner_id) if learner_id else None
    if not can_curate(actor, x_admin_token):
        raise HTTPException(status_code=403, detail="Only a trainer, manager, BU head, HR or an admin.")

    today = dt.date.today()
    rows = (
        db.query(CourseAssignment, Learner)
        .join(Learner, Learner.id == CourseAssignment.learner_id)
        .filter(
            CourseAssignment.entity_type == entity_type,
            CourseAssignment.entity_id == entity_id,
        )
        .all()
    )
    teams = {t.id: t.name for t in db.query(Team).all()}

    people = []
    for assignment, learner in rows:
        done, total = _progress(db, entity_type, entity_id, learner.id)
        complete = total > 0 and done >= total
        people.append({
            "learner_id": learner.id,
            "handle": learner.handle,
            "name": learner.name or learner.handle,
            "email": learner.email or "",
            "bu": learner.bu or "",
            "mandatory": assignment.mandatory,
            "due_date": assignment.due_date.isoformat() if assignment.due_date else None,
            "assigned_by": assignment.assigned_by,
            "via_team": teams.get(assignment.via_team_id, "") if assignment.via_team_id else "",
            "percent": round(100 * done / total) if total else 0,
            "status": "completed" if complete else ("in_progress" if done else "not_started"),
            # Overdue is the deadline passing, not somebody being slow.
            "overdue": bool(assignment.due_date and not complete and assignment.due_date < today),
        })
    # Whoever needs chasing first: overdue, then furthest behind.
    people.sort(key=lambda p: (not p["overdue"], p["percent"], p["name"]))

    return {
        "people": people,
        "summary": {
            "assigned": len(people),
            "mandatory": sum(1 for p in people if p["mandatory"]),
            "completed": sum(1 for p in people if p["status"] == "completed"),
            "in_progress": sum(1 for p in people if p["status"] == "in_progress"),
            "not_started": sum(1 for p in people if p["status"] == "not_started"),
            "overdue": sum(1 for p in people if p["overdue"]),
        },
    }


@router.get("/tracking")
def tracking(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Every assignment in the viewer's perimeter, and where each person got to.

    One row per person per assignment, carrying the three things a follow-up
    conversation needs: how far they are, what they scored, and how many times
    they have tried. Attempts matter as much as the score — six failures at 68
    is a different conversation from one pass at 71.
    """
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not can_read_reporting(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="HR, L&D or an admin only.")
    scope = oversight_scope(db, viewer, x_admin_token)
    today = dt.date.today()

    rows = db.query(CourseAssignment).all()
    people = {l.id: l for l in db.query(Learner).all()}
    teams = {t.id: t.name for t in db.query(Team).all()}

    items = []
    for row in rows:
        learner = people.get(row.learner_id)
        if not learner or not scope.allows(learner.id):
            continue
        try:
            title = _title(db, row.entity_type, row.entity_id)
        except HTTPException:
            continue  # the content was deleted; the assignment is stale
        done, total = _progress(db, row.entity_type, row.entity_id, learner.id)
        complete = total > 0 and done >= total
        # An acceptance outranks the measurement: it is the later fact, and a
        # human looked at evidence the platform cannot reach. The row still says
        # who decided, so nobody has to take it on trust.
        if row.accepted_on:
            complete = True
            done = total = total or 1

        attempts = (
            db.query(AssessmentAttempt)
            .filter_by(entity_type=row.entity_type, entity_id=row.entity_id, learner_id=learner.id)
            .all()
        )
        scored = [a.score for a in attempts if a.score is not None]

        items.append({
            # The assignment itself, so the board can act on the row.
            "id": row.id,
            "kind": row.entity_type,
            "entity_id": row.entity_id,
            "title": title,
            "link": _link(row.entity_type, row.entity_id),
            "learner_id": learner.id,
            "name": learner.name or learner.handle,
            "email": learner.email,
            "bu": learner.bu,
            "team": teams.get(learner.team_id, "") if learner.team_id else "",
            "mandatory": row.mandatory,
            "assigned_by": row.assigned_by,
            "via_team": teams.get(row.via_team_id, "") if row.via_team_id else "",
            "due_date": row.due_date.isoformat() if row.due_date else None,
            "overdue": bool(row.due_date and not complete and row.due_date < today),
            "done": done,
            "total": total,
            # None = not provider content. False = assigned, and the provider
            # has never heard of them: the one list where chasing changes the
            # number, because nothing else will move until they sign up.
            "provider_enrolled": _provider_enrolled(db, row.entity_type, row.entity_id, learner.id),
            "percent": round(100 * done / total) if total else 0,
            "status": "completed" if complete else ("in_progress" if done else "not_started"),
            "accepted_on": row.accepted_on.isoformat() if row.accepted_on else None,
            "accepted_by": row.accepted_by,
            "accepted_note": row.accepted_note,
            "attempts": len(attempts),
            "failed_attempts": sum(1 for a in attempts if not a.passed),
            "best_score": round(max(scored)) if scored else None,
            "last_score": round(scored[-1]) if scored else None,
        })

    items.sort(key=lambda i: (not i["overdue"], not i["mandatory"], i["percent"]))
    # When the provider figures on this page were last refreshed. Every number
    # here that comes from Coursera is as of this moment, not of now, and a
    # board that does not say so invites somebody to read it as live.
    synced_at = (
        db.query(func.max(ExternalEnrollment.synced_at))
        .filter(ExternalEnrollment.provider == "coursera")
        .scalar()
    )
    return {
        "scope": scope.label,
        "provider_synced_at": synced_at.isoformat() if synced_at else None,
        "items": items,
        "totals": {
            "assignments": len(items),
            "people": len({i["learner_id"] for i in items}),
            "mandatory": sum(1 for i in items if i["mandatory"]),
            "completed": sum(1 for i in items if i["status"] == "completed"),
            # Of those, closed on a decision rather than on a sync. A figure
            # that leans on judgement should say how much of it does.
            "accepted": sum(1 for i in items if i["accepted_on"]),
            "overdue": sum(1 for i in items if i["overdue"]),
            "never_started": sum(1 for i in items if i["status"] == "not_started"),
            # Assigned, and never signed up on the provider at all.
            "not_enrolled": sum(1 for i in items if i["provider_enrolled"] is False),
            "struggling": sum(1 for i in items if i["failed_attempts"] >= 2),
        },
    }
