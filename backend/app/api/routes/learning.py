"""Self-reported learning — "I learned this".

The platform sees what happens inside it, plus whatever a connected provider
reports. For most people that is a minority of what they actually learn: the
article at breakfast, the book, the conference talk, the afternoon paired with
a colleague. Without a way to log those, the hours figure is not just
incomplete, it is biased towards whatever happens to be instrumented.

Records are trusted by default. Requiring approval before a record counts
would kill the habit that makes the feature work; a manager can *verify* one
afterwards, and HR reporting keeps self-declared time in its own bucket so the
weaker evidence is never silently blended into measured time.
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import (
    Learner,
    LearningRecord,
    LearningRecordSkill,
    Skill,
    Team,
)
from app.models.learning_record import RECORD_KINDS

router = APIRouter(prefix="/learning", tags=["learning"])


class LearningRecordIn(BaseModel):
    learner_id: int
    kind: str = "article"
    title: str = Field(min_length=2, max_length=255)
    url: str = ""
    provider: str = ""
    minutes: int = 0
    notes: str = ""
    completed_on: dt.date | None = None
    skill_ids: list[int] = []


def _can_verify(viewer: Learner | None, subject: Learner, db: Session) -> bool:
    """A manager, the team's Skill Lead, HR or an admin may vouch for a record."""
    if viewer is None:
        return False
    if viewer.role in ("hr", "hr_lead", "admin"):
        return True
    if subject.team_id:
        team = db.get(Team, subject.team_id)
        if team and viewer.id in (team.manager_id, team.lead_id):
            return True
    return False


def _out(db: Session, record: LearningRecord, skills_by_id: dict[int, Skill]) -> dict:
    skill_ids = [
        link.skill_id
        for link in db.query(LearningRecordSkill).filter_by(record_id=record.id)
    ]
    return {
        "id": record.id,
        "learner_id": record.learner_id,
        "kind": record.kind,
        "title": record.title,
        "url": record.url,
        "provider": record.provider,
        # The provider course this claims, when it claims one: what makes a
        # declaration countable against a specialization.
        "external_slug": record.external_slug,
        "minutes": record.minutes,
        "hours": round(record.minutes / 60, 1),
        "notes": record.notes,
        "completed_on": record.completed_on,
        "verified": record.review_status == "verified",
        "review_status": record.review_status,
        "review_note": record.review_note,
        "verified_by_name": record.verified_by_name,
        "created_at": record.created_at,
        "skills": [
            {"id": sid, "name": skills_by_id[sid].name}
            for sid in skill_ids
            if sid in skills_by_id
        ],
    }


@router.get("/kinds")
def kinds():
    """The kinds of learning that can be logged."""
    return {"kinds": list(RECORD_KINDS)}


@router.get("/records")
def list_records(
    learner_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """One person's logged learning, newest first."""
    rows = (
        db.query(LearningRecord)
        .filter(LearningRecord.learner_id == learner_id)
        .order_by(LearningRecord.id.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    skills_by_id = {s.id: s for s in db.query(Skill).all()}
    return [_out(db, r, skills_by_id) for r in rows]


@router.post("/records", status_code=201)
def create_record(payload: LearningRecordIn, db: Session = Depends(get_db)):
    learner = db.get(Learner, payload.learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    if payload.kind not in RECORD_KINDS:
        raise HTTPException(
            status_code=400, detail=f"kind must be one of: {', '.join(RECORD_KINDS)}"
        )

    record = LearningRecord(
        learner_id=learner.id,
        kind=payload.kind,
        title=payload.title.strip(),
        url=payload.url.strip(),
        provider=payload.provider.strip(),
        # Cap at a working day: a single record claiming 40 hours is a data
        # entry mistake far more often than it is a fact.
        minutes=max(0, min(payload.minutes, 12 * 60)),
        notes=payload.notes.strip(),
        completed_on=payload.completed_on or dt.date.today(),
    )
    db.add(record)
    db.flush()

    for sid in dict.fromkeys(payload.skill_ids):
        if db.get(Skill, sid):
            db.add(LearningRecordSkill(record_id=record.id, skill_id=sid))

    db.commit()
    db.refresh(record)
    return _out(db, record, {s.id: s for s in db.query(Skill).all()})


class CourseraClaimIn(BaseModel):
    learner_id: int
    # The course page, e.g. https://www.coursera.org/learn/getting-started-with-git-and-github
    course_url: str
    # The certificate, so a reviewer can check the claim in one click. Optional:
    # a claim with no proof is still worth having, it is just weaker.
    certificate_url: str = ""
    completed_on: dt.date | None = None


@router.post("/records/coursera", status_code=201)
def declare_coursera(payload: CourseraClaimIn, db: Session = Depends(get_db)):
    """Log a Coursera course taken outside the organisation's programmes.

    The enterprise report only carries enrolments made through a programme — on
    the live data, 2,889 rows out of 2,889 — so anything somebody did on their
    own account is invisible to the sync and always will be. This is how it
    reaches the platform: the learner names the course, the catalogue fills in
    the title and the hours so the record is consistent with the synced ones,
    and the slug is kept so the completion can count towards a specialization.

    It is a claim, not a measurement. It arrives `pending`, carries whatever
    proof they gave, and a manager, L&D or HR can verify it.
    """
    from app.connectors.coursera import CourseraCatalog
    from app.core.external_progress import slug_from_url

    learner = db.get(Learner, payload.learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    slug = slug_from_url(payload.course_url.strip())
    if not slug:
        raise HTTPException(
            status_code=400,
            detail="That is not a Coursera course link. Expected .../learn/<course>.",
        )
    with CourseraCatalog() as catalog:
        found = catalog.by_slug(slug)
    if not found:
        raise HTTPException(
            status_code=404, detail=f"Coursera does not list a course called '{slug}'."
        )

    existing = (
        db.query(LearningRecord)
        .filter_by(learner_id=learner.id, external_slug=slug)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409, detail=f"You already logged “{existing.title}”."
        )

    hours = found.get("estimated_hours") or 0
    record = LearningRecord(
        learner_id=learner.id,
        kind="course",
        title=found["title"],
        url=payload.certificate_url.strip() or found["external_url"],
        provider="Coursera",
        # The catalogue's published length, capped like any other record. It is
        # an estimate and is reported as declared time, never as measured.
        minutes=max(0, min(int(hours * 60), 12 * 60)),
        notes="Suivi hors programme, déclaré par l'apprenant.",
        completed_on=payload.completed_on or dt.date.today(),
        external_slug=slug,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _out(db, record, {s.id: s for s in db.query(Skill).all()})


@router.delete("/records/{record_id}", status_code=204)
def delete_record(record_id: int, learner_id: int, db: Session = Depends(get_db)):
    record = db.get(LearningRecord, record_id)
    if not record:
        return
    viewer = db.get(Learner, learner_id)
    owner = record.learner_id == learner_id
    if not (owner or (viewer and viewer.role in ("hr", "hr_lead", "admin"))):
        raise HTTPException(status_code=403, detail="Only the author or an admin can delete this.")
    db.delete(record)
    db.commit()


@router.post("/records/{record_id}/verify")
def verify_record(record_id: int, learner_id: int, db: Session = Depends(get_db)):
    """Vouch for a record. Unverified records still count — this only marks
    the ones someone in the line of management has confirmed."""
    record = db.get(LearningRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    viewer = db.get(Learner, learner_id)
    subject = db.get(Learner, record.learner_id)
    if not subject or not _can_verify(viewer, subject, db):
        raise HTTPException(
            status_code=403,
            detail="Only the person's manager, Skill Lead, HR or an admin can verify a record.",
        )
    if viewer.id == record.learner_id:
        raise HTTPException(status_code=400, detail="You cannot verify your own record.")

    record.review_status = "verified"
    record.reviewed_at = dt.datetime.now(dt.timezone.utc)
    record.verified_by_id = viewer.id
    record.verified_by_name = viewer.name or viewer.handle
    db.commit()
    return {"verified": True, "by": record.verified_by_name}
