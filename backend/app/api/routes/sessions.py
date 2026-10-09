"""Training sessions with registration and attendance.

A session is either attached to a formation (kickoff, workshop, exam) or
standalone and `open_to_all` — an open session on a theme that anyone in the
company may register for, with a capacity, a room, a trainer and a
registration deadline.

Registration enforces capacity server-side: the first `capacity` sign-ups are
`registered`, the rest are `waitlisted`, and cancelling promotes the person who
has waited longest. Once the session has happened the trainer takes a register,
which is what feeds the `présence` HR KPI.

`GET /training-sessions/{id}/ics` hands back a calendar file so a trainee can
drop the session into Outlook. That is a one-way export, not a mailbox sync —
two-way Microsoft Graph integration is a separate piece of work.
"""

import datetime as dt
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email_template import Button, render_email
from app.core.i18n import t as translate
from app.core.i18n import tr
from app.core.mailer import send_email
from app.core.notifier import notify
from app.db.session import get_db
from app.models import (
    Formation,
    FormationEnrollment,
    FormationSession,
    Learner,
    SessionGuest,
    SessionRegistration,
)
from app.schemas.formation import (
    AttendanceRequest,
    RegistrationRequest,
    RosterEntry,
    SessionCreate,
    UpcomingEvent,
)

router = APIRouter(prefix="/training-sessions", tags=["training-sessions"])

ORGANISER_ROLES = ("trainer", "manager", "bu_head", "hr", "admin")


# --------------------------------------------------------------------------- #
# helpers                                                                     #
# --------------------------------------------------------------------------- #


def _is_admin_token(token: str | None) -> bool:
    return bool(settings.admin_token) and token == settings.admin_token


def _can_organise(learner: Learner | None, token: str | None) -> bool:
    if _is_admin_token(token):
        return True
    return learner is not None and learner.role in ORGANISER_ROLES


def _can_manage_session(
    db: Session, session: FormationSession, viewer: Learner | None, token: str | None
) -> bool:
    """The session's own trainer, its formation's trainer, its creator, or an
    admin/HR may edit it and take the register."""
    if _is_admin_token(token):
        return True
    if viewer is None:
        return False
    if viewer.role in ("admin", "hr", "hr_lead"):
        return True
    if viewer.id in (session.trainer_id, session.created_by_id):
        return True
    if session.formation_id:
        formation = db.get(Formation, session.formation_id)
        if formation and formation.trainer_id == viewer.id:
            return True
    return False


def _get_session(db: Session, session_id: int) -> FormationSession:
    session = db.get(FormationSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _as_utc(value: dt.datetime) -> dt.datetime:
    """Rows written before timezone awareness was enforced can come back naive."""
    return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)


def _counts(db: Session, session_id: int) -> tuple[int, int]:
    rows = db.query(SessionRegistration).filter_by(session_id=session_id).all()
    registered = sum(1 for r in rows if r.status == "registered")
    waitlisted = sum(1 for r in rows if r.status == "waitlisted")
    return registered, waitlisted


def _registration_open(session: FormationSession) -> bool:
    """Open while the deadline (or, failing that, the start) is ahead. A full
    session still accepts sign-ups — they land on the waitlist."""
    deadline = session.registration_deadline or session.starts_at
    return _as_utc(deadline) > _now()


def _event(
    db: Session,
    session: FormationSession,
    viewer: Learner | None,
    formation: Formation | None = None,
) -> UpcomingEvent:
    if formation is None and session.formation_id:
        formation = db.get(Formation, session.formation_id)

    registered, waitlisted = _counts(db, session.id)
    mine = None
    my_status = None
    if viewer:
        reg = (
            db.query(SessionRegistration)
            .filter_by(session_id=session.id, learner_id=viewer.id)
            .first()
        )
        mine = reg.status if reg else None
        if formation:
            if formation.trainer_id == viewer.id:
                my_status = "trainer"
            else:
                enr = (
                    db.query(FormationEnrollment)
                    .filter_by(formation_id=formation.id, learner_id=viewer.id)
                    .first()
                )
                my_status = enr.status if enr else None
        if session.trainer_id == viewer.id:
            my_status = "trainer"

    return UpcomingEvent(
        id=session.id,
        formation_id=session.formation_id,
        title=session.title,
        description=session.description,
        starts_at=session.starts_at,
        duration_min=session.duration_min,
        location=session.location,
        meeting_url=session.meeting_url,
        open_to_all=session.open_to_all,
        capacity=session.capacity,
        registration_deadline=session.registration_deadline,
        theme=session.theme,
        trainer_name=session.trainer_name or (formation.trainer_name if formation else ""),
        registered_count=registered,
        waitlist_count=waitlisted,
        seats_left=max(0, session.capacity - registered) if session.capacity else None,
        registration_open=_registration_open(session),
        my_registration=mine,
        formation_title=formation.title if formation else "",
        formation_emoji=formation.emoji if formation else "📅",
        formation_level=formation.level if formation else "",
        my_status=my_status,
    )


# --------------------------------------------------------------------------- #
# listing & CRUD                                                              #
# --------------------------------------------------------------------------- #


@router.get("", response_model=list[UpcomingEvent])
def list_sessions(
    learner_id: int | None = None,
    days: int = 90,
    open_only: bool = False,
    include_past: bool = False,
    db: Session = Depends(get_db),
):
    """Upcoming sessions the viewer may see: open sessions plus the sessions of
    published formations (drafts stay on their trainer's schedule)."""
    viewer = db.get(Learner, learner_id) if learner_id else None
    horizon = _now() + dt.timedelta(days=max(1, min(days, 365)))

    q = db.query(FormationSession).filter(FormationSession.starts_at <= horizon)
    if not include_past:
        q = q.filter(FormationSession.starts_at >= _now())
    if open_only:
        q = q.filter(FormationSession.open_to_all.is_(True))

    events: list[UpcomingEvent] = []
    for session in q.order_by(FormationSession.starts_at).all():
        formation = db.get(Formation, session.formation_id) if session.formation_id else None
        if formation and formation.status != "published":
            is_trainer = viewer is not None and viewer.id in (
                formation.trainer_id,
                session.trainer_id,
            )
            if not is_trainer:
                continue
        events.append(_event(db, session, viewer, formation))
    return events


@router.post("", response_model=UpcomingEvent, status_code=201)
def create_session(
    payload: SessionCreate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Schedule a session. With no `formation_id` it is a standalone open
    session on a theme, which is the "session for ALL" case."""
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_organise(viewer, x_admin_token):
        raise HTTPException(
            status_code=403,
            detail="Only trainers, Skill Leads, managers, HR or admins can schedule sessions.",
        )

    formation = None
    if payload.formation_id:
        formation = db.get(Formation, payload.formation_id)
        if not formation:
            raise HTTPException(status_code=404, detail="Training not found")

    trainer = None
    if payload.trainer_handle:
        trainer = (
            db.query(Learner).filter(Learner.handle.ilike(payload.trainer_handle.strip())).first()
        )
        if not trainer:
            raise HTTPException(status_code=404, detail="Trainer handle not found")
    trainer = trainer or viewer

    session = FormationSession(
        formation_id=payload.formation_id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        starts_at=payload.starts_at,
        duration_min=max(5, payload.duration_min),
        location=payload.location.strip(),
        meeting_url=payload.meeting_url.strip(),
        # A session with no formation has to be open — nobody else could reach it.
        open_to_all=payload.open_to_all or payload.formation_id is None,
        capacity=max(0, payload.capacity),
        registration_deadline=payload.registration_deadline,
        theme=payload.theme.strip(),
        trainer_id=trainer.id if trainer else None,
        trainer_name=(trainer.name or trainer.handle) if trainer else "",
        created_by_id=viewer.id if viewer else None,
    )
    db.add(session)
    db.flush()

    when = payload.starts_at.strftime("%a %d %b, %H:%M")
    where = f" · {session.location}" if session.location else ""
    if formation:
        audience = [
            e.learner_id
            for e in db.query(FormationEnrollment).filter(
                FormationEnrollment.formation_id == formation.id,
                FormationEnrollment.status.in_(("active", "completed", "invited")),
            )
        ]
    else:
        # An open session is announced to everyone who could attend it.
        audience = [row[0] for row in db.query(Learner.id).all()]

    # A broadcast can't be per-recipient without N queries, so it follows the
    # organiser's language — the one who chose the wording of the session too.
    locale = viewer.locale if viewer else None
    body = (
        translate(locale, "session.new.body.formation",
                  formation=formation.title, when=when, where=where)
        if formation
        else translate(locale, "session.new.body.open", when=when, where=where)
    )
    notify(
        db,
        audience,
        kind="session",
        title=translate(locale, "session.new.title", title=session.title),
        body=body,
        link="/schedule",
        exclude=viewer.id if viewer else None,
    )
    db.commit()
    db.refresh(session)
    return _event(db, session, viewer, formation)


@router.put("/{session_id}", response_model=UpcomingEvent)
def update_session(
    session_id: int,
    payload: SessionCreate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id)
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_manage_session(db, session, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the session's trainer or an admin can edit it.")

    session.title = payload.title.strip()
    session.description = payload.description.strip()
    session.starts_at = payload.starts_at
    session.duration_min = max(5, payload.duration_min)
    session.location = payload.location.strip()
    session.meeting_url = payload.meeting_url.strip()
    session.theme = payload.theme.strip()
    session.registration_deadline = payload.registration_deadline
    session.open_to_all = payload.open_to_all or session.formation_id is None

    previous_capacity = session.capacity
    session.capacity = max(0, payload.capacity)
    if session.capacity != previous_capacity:
        _rebalance_waitlist(db, session)

    db.commit()
    db.refresh(session)
    return _event(db, session, viewer)


@router.delete("/{session_id}", status_code=204)
def delete_session(
    session_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage_session(db, session, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the session's trainer or an admin can delete it.")
    db.delete(session)
    db.commit()


# --------------------------------------------------------------------------- #
# registration                                                                #
# --------------------------------------------------------------------------- #


def _rebalance_waitlist(db: Session, session: FormationSession) -> list[SessionRegistration]:
    """Promote waitlisted people into any free seats, oldest sign-up first.

    Returns the promoted rows so the caller can notify them."""
    if not session.capacity:
        promoted = (
            db.query(SessionRegistration)
            .filter_by(session_id=session.id, status="waitlisted")
            .order_by(SessionRegistration.created_at)
            .all()
        )
    else:
        registered = (
            db.query(SessionRegistration)
            .filter_by(session_id=session.id, status="registered")
            .count()
        )
        free = session.capacity - registered
        if free <= 0:
            return []
        promoted = (
            db.query(SessionRegistration)
            .filter_by(session_id=session.id, status="waitlisted")
            .order_by(SessionRegistration.created_at)
            .limit(free)
            .all()
        )
    for reg in promoted:
        reg.status = "registered"
    return promoted


@router.post("/{session_id}/register")
def register(session_id: int, payload: RegistrationRequest, db: Session = Depends(get_db)):
    session = _get_session(db, session_id)
    learner = db.get(Learner, payload.learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    registered, _ = _counts(db, session.id)
    if not _registration_open(session):
        raise HTTPException(status_code=409, detail="Les inscriptions pour cette session sont closes.")

    if not session.open_to_all and session.formation_id:
        enrolled = (
            db.query(FormationEnrollment)
            .filter_by(formation_id=session.formation_id, learner_id=learner.id)
            .first()
        )
        if not enrolled:
            raise HTTPException(
                status_code=403,
                detail="Cette session est réservée aux inscrits de la formation.",
            )

    reg = (
        db.query(SessionRegistration)
        .filter_by(session_id=session.id, learner_id=learner.id)
        .first()
    )
    if reg and reg.status != "cancelled":
        return {"status": reg.status, "already": True}

    full = bool(session.capacity) and registered >= session.capacity
    status = "waitlisted" if full else "registered"
    if reg:
        reg.status = status
    else:
        db.add(SessionRegistration(session_id=session.id, learner_id=learner.id, status=status))

    when = _as_utc(session.starts_at).strftime("%a %d %b, %H:%M")
    where = f" · {session.location}" if session.location else ""
    # Rendered in the recipient's own language: this text is stored, so it
    # cannot be re-translated if they switch later.
    key = "session.registered" if status == "registered" else "session.waitlisted"
    title = tr(learner, f"{key}.title", title=session.title)
    body = tr(learner, f"{key}.body", when=when, where=where)
    notify(db, [learner.id], kind="session", title=title, body=body, link="/schedule")
    if learner.email:
        html, body_text = render_email(
            heading=title,
            preheader=body,
            blocks=[
                ("p", body),
                (
                    "stats",
                    [
                        (tr(learner, "session.when"), when),
                        (tr(learner, "session.where"), session.location or "—"),
                    ],
                ),
            ],
            button=Button(
                tr(learner, "session.cta"), f"{settings.frontend_origin}/schedule"
            ),
        )
        send_email(learner.email, title, html, body_text)
    db.commit()
    return {"status": status, "already": False}


@router.post("/{session_id}/cancel")
def cancel(session_id: int, payload: RegistrationRequest, db: Session = Depends(get_db)):
    session = _get_session(db, session_id)
    reg = (
        db.query(SessionRegistration)
        .filter_by(session_id=session.id, learner_id=payload.learner_id)
        .first()
    )
    if not reg or reg.status == "cancelled":
        return {"status": "cancelled", "promoted": []}

    reg.status = "cancelled"
    reg.attended = None
    db.flush()

    promoted = _rebalance_waitlist(db, session)
    for row in promoted:
        promoted_learner = db.get(Learner, row.learner_id)
        notify(
            db,
            [row.learner_id],
            kind="session",
            title=tr(promoted_learner, "session.promoted.title", title=session.title),
            body=tr(promoted_learner, "session.promoted.body"),
            link="/schedule",
        )
    db.commit()
    return {"status": "cancelled", "promoted": [r.learner_id for r in promoted]}


@router.get("/{session_id}/roster", response_model=list[RosterEntry])
def roster(
    session_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage_session(db, session, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the session's trainer or an admin can see the roster.")

    rows = (
        db.query(SessionRegistration, Learner)
        .join(Learner, SessionRegistration.learner_id == Learner.id)
        .filter(SessionRegistration.session_id == session.id)
        .order_by(SessionRegistration.status, SessionRegistration.created_at)
        .all()
    )
    return [
        RosterEntry(
            learner_id=learner.id,
            handle=learner.handle,
            name=learner.name,
            status=reg.status,
            attended=reg.attended,
        )
        for reg, learner in rows
    ]


@router.post("/{session_id}/attendance")
def mark_attendance(
    session_id: int,
    payload: AttendanceRequest,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Take the register. Only people who registered can be marked, so the
    attendance rate always has a denominator that means something."""
    session = _get_session(db, session_id)
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_manage_session(db, session, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the session's trainer or an admin can take attendance.")

    marker = (viewer.name or viewer.handle) if viewer else "admin"
    updated = 0
    for mark in payload.marks:
        reg = (
            db.query(SessionRegistration)
            .filter_by(session_id=session.id, learner_id=mark.learner_id)
            .first()
        )
        if not reg or reg.status == "cancelled":
            continue
        reg.attended = mark.attended
        reg.marked_by = marker
        updated += 1
    db.commit()
    return {"updated": updated}


# --------------------------------------------------------------------------- #
# calendar export                                                             #
# --------------------------------------------------------------------------- #


def _ics_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _ics_fold(line: str) -> str:
    """RFC 5545 caps a content line at 75 octets; continuations start with a
    space. Outlook rejects over-long unfolded lines."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    chunks, current = [], b""
    for char in line:
        encoded = char.encode("utf-8")
        limit = 75 if not chunks else 74  # continuation lines lose one octet to the space
        if len(current) + len(encoded) > limit:
            chunks.append(current)
            current = b""
        current += encoded
    chunks.append(current)
    return "\r\n ".join(c.decode("utf-8") for c in chunks)


@router.get("/{session_id}/ics")
def session_ics(session_id: int, db: Session = Depends(get_db)):
    """Download the session as a calendar file.

    Importable into Outlook, Google Calendar or Apple Calendar. This is a
    one-way export — it does not write to anyone's mailbox."""
    session = _get_session(db, session_id)
    formation = db.get(Formation, session.formation_id) if session.formation_id else None

    starts = _as_utc(session.starts_at)
    ends = starts + dt.timedelta(minutes=session.duration_min)
    stamp = _now()

    description_parts = [session.description]
    if formation:
        description_parts.append(f"Formation : {formation.title}")
    trainer = session.trainer_name or (formation.trainer_name if formation else "")
    if trainer:
        description_parts.append(f"Formateur : {trainer}")
    if session.meeting_url:
        description_parts.append(session.meeting_url)
    description = "\n".join(p for p in description_parts if p)

    def fmt(value: dt.datetime) -> str:
        return value.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//UpSkill//Training Sessions//FR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:aida-session-{session.id}@aida",
        f"DTSTAMP:{fmt(stamp)}",
        f"DTSTART:{fmt(starts)}",
        f"DTEND:{fmt(ends)}",
        f"SUMMARY:{_ics_escape(session.title)}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{_ics_escape(description)}")
    if session.location or session.meeting_url:
        lines.append(f"LOCATION:{_ics_escape(session.location or session.meeting_url)}")
    if session.meeting_url:
        lines.append(f"URL:{_ics_escape(session.meeting_url)}")
    if trainer:
        lines.append(f"ORGANIZER;CN={_ics_escape(trainer)}:mailto:{settings.mail_from_address}")
    lines += ["END:VEVENT", "END:VCALENDAR"]

    body = "\r\n".join(_ics_fold(line) for line in lines) + "\r\n"
    filename = f"session-{session.id}.ics"
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --------------------------------------------------------------------------- #
# external guests                                                             #
# --------------------------------------------------------------------------- #


class GuestIn(BaseModel):
    """One outside attendee. `company` is what the roster shows beside them."""

    email: str
    name: str = ""
    company: str = ""
    learner_id: int | None = None  # the organiser


@router.post("/{session_id}/guests", status_code=201)
def invite_guest(
    session_id: int,
    payload: GuestIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Invite somebody from outside the company to this session.

    They get an email with the session details, a calendar file and two links —
    accept or decline. There is no account and no password: the token in those
    links is the only thing that identifies them, which is the right amount of
    ceremony for being asked to a workshop.
    """
    session = _get_session(db, session_id)
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_manage_session(db, session, viewer, x_admin_token):
        raise HTTPException(
            status_code=403, detail="Only the session's trainer or an admin can invite guests."
        )

    email = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="That is not an email address.")
    if db.query(Learner).filter(Learner.email.ilike(email)).first():
        raise HTTPException(
            status_code=409,
            detail="That address belongs to a colleague — register them instead of inviting them as a guest.",
        )

    guest = db.query(SessionGuest).filter_by(session_id=session.id, email=email).first()
    if guest:
        raise HTTPException(status_code=409, detail=f"{email} is already invited.")

    by = (viewer.name or viewer.handle) if viewer else "UpSkill"
    guest = SessionGuest(
        session_id=session.id,
        email=email,
        name=payload.name.strip()[:160],
        company=payload.company.strip()[:120],
        invited_by=by,
        token=secrets.token_urlsafe(32),
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)

    base = settings.frontend_origin.rstrip("/")
    when = session.starts_at.strftime("%d/%m/%Y %H:%M")
    where = session.meeting_url or session.location or "—"
    blocks: list = [
        ("p", f"{by} invites you to <b>{session.title}</b>."),
        ("stats", [("Date", when), ("Durée", f"{session.duration_min} min"), ("Lieu", where)]),
    ]
    if session.description:
        blocks.append(("note", session.description))
    html, text = render_email(
        heading=session.title,
        preheader=f"{by} — {when}",
        blocks=blocks,
        button=Button("Confirmer ma présence", f"{base}/guest/{guest.token}?reply=accepted"),
        footer_note=f"Décliner : {base}/guest/{guest.token}?reply=declined",
    )
    send_email(guest.email, f"[UpSkill] {session.title}", html, text)

    return _guest_out(guest)


def _guest_out(guest: "SessionGuest") -> dict:
    return {
        "id": guest.id,
        "email": guest.email,
        "name": guest.name or guest.email,
        "company": guest.company,
        "status": guest.status,
        "attended": guest.attended,
        "invited_by": guest.invited_by,
    }


@router.get("/{session_id}/guests")
def list_guests(
    session_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage_session(db, session, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the session's trainer or an admin can see this.")
    rows = db.query(SessionGuest).filter_by(session_id=session.id).order_by(SessionGuest.id).all()
    return [_guest_out(g) for g in rows]


@router.delete("/{session_id}/guests/{guest_id}", status_code=204)
def withdraw_guest(
    session_id: int,
    guest_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    session = _get_session(db, session_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage_session(db, session, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the session's trainer or an admin can do this.")
    guest = db.get(SessionGuest, guest_id)
    if guest and guest.session_id == session.id:
        db.delete(guest)
        db.commit()


class GuestMark(BaseModel):
    guest_id: int
    attended: bool
    learner_id: int | None = None


@router.post("/{session_id}/guests/attendance")
def mark_guest_attendance(
    session_id: int,
    payload: GuestMark,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Take the register for a guest.

    Kept separate from the learner register on purpose: this mark never reaches
    the attendance KPI, because the rate is about the organisation's own people
    and a client sitting in would otherwise move it.
    """
    session = _get_session(db, session_id)
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_manage_session(db, session, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the session's trainer or an admin can take attendance.")
    guest = db.get(SessionGuest, payload.guest_id)
    if not guest or guest.session_id != session.id:
        raise HTTPException(status_code=404, detail="Guest not found on this session.")
    guest.attended = payload.attended
    db.commit()
    return _guest_out(guest)


class GuestReply(BaseModel):
    reply: str  # accepted | declined


@router.post("/guest/{token}/reply")
def guest_reply(token: str, payload: GuestReply, db: Session = Depends(get_db)):
    """A guest answering their invitation. The token is the whole credential."""
    if payload.reply not in ("accepted", "declined"):
        raise HTTPException(status_code=400, detail="reply must be accepted or declined.")
    guest = db.query(SessionGuest).filter_by(token=token).first()
    if not guest:
        raise HTTPException(status_code=404, detail="This invitation is no longer valid.")
    guest.status = payload.reply
    guest.responded_at = dt.datetime.now(dt.timezone.utc)
    db.commit()

    session = db.get(FormationSession, guest.session_id)
    return {
        "status": guest.status,
        "session": {
            "title": session.title,
            "starts_at": session.starts_at.isoformat(),
            "duration_min": session.duration_min,
            "location": session.location,
            "meeting_url": session.meeting_url,
        },
    }


@router.get("/guest/{token}")
def guest_invitation(token: str, db: Session = Depends(get_db)):
    """What a guest sees when they open their link. No account required."""
    guest = db.query(SessionGuest).filter_by(token=token).first()
    if not guest:
        raise HTTPException(status_code=404, detail="This invitation is no longer valid.")
    session = db.get(FormationSession, guest.session_id)
    return {
        "guest": {"name": guest.name or guest.email, "company": guest.company, "status": guest.status},
        "invited_by": guest.invited_by,
        "session": {
            "id": session.id,
            "title": session.title,
            "description": session.description,
            "starts_at": session.starts_at.isoformat(),
            "duration_min": session.duration_min,
            "location": session.location,
            "meeting_url": session.meeting_url,
        },
    }
