"""Engagement layer: comments, likes and shares on courses & trainings.

`entity_type` is "course" or "formation". One endpoint returns everything the
UI needs for an entity; likes toggle, shares are idempotent per person.
"""

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.notifier import notify
from app.db.session import get_db
from app.models import (
    Comment,
    Course,
    Engagement,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    Learner,
    Review,
)
from app.schemas.formation import lesson_ids

router = APIRouter(prefix="/social", tags=["social"])

ENTITY_TYPES = ("course", "formation")


def _check_entity(db: Session, etype: str, eid: int):
    if etype not in ENTITY_TYPES:
        raise HTTPException(status_code=400, detail=f"entity_type must be one of {ENTITY_TYPES}")
    model = Course if etype == "course" else Formation
    entity = db.get(model, eid)
    if not entity:
        raise HTTPException(status_code=404, detail=f"{etype} not found")
    return entity


def _owner_of(entity) -> tuple[int | None, str]:
    if isinstance(entity, Formation):
        return entity.trainer_id, entity.title
    return entity.learner_id, entity.title


class CommentIn(BaseModel):
    learner_id: int
    body: str = Field(min_length=1, max_length=1000)


class ActorIn(BaseModel):
    learner_id: int

class RatingIn(BaseModel):
    learner_id: int
    stars: int = Field(ge=1, le=5)

def _counts(db: Session, etype: str, eid: int) -> dict:
    rows = dict(
        db.query(Engagement.kind, func.count())
        .filter(Engagement.entity_type == etype, Engagement.entity_id == eid)
        .group_by(Engagement.kind)
    )
    return {"likes": rows.get("like", 0), "shares": rows.get("share", 0)}

def _rating_stats(db: Session, etype: str, eid: int) -> dict:
    avg, count = (
        db.query(func.avg(Review.stars), func.count(Review.id))
        .filter(Review.entity_type == etype, Review.entity_id == eid)
        .one()
    )
    return {"avg_stars": round(avg, 1) if avg is not None else None, "reviews_count": count}


@router.get("/{etype}/{eid}")
def engagement(etype: str, eid: int, learner_id: int | None = None, db: Session = Depends(get_db)):
    _check_entity(db, etype, eid)
    comments = (
        db.query(Comment, Learner)
        .join(Learner, Comment.learner_id == Learner.id)
        .filter(Comment.entity_type == etype, Comment.entity_id == eid)
        .order_by(Comment.id.desc())
        .limit(100)
        .all()
    )
    liked = shared = False
    my_stars = None
    if learner_id:
        mine = {
            e.kind
            for e in db.query(Engagement).filter_by(
                entity_type=etype, entity_id=eid, learner_id=learner_id
            )
        }
        liked, shared = "like" in mine, "share" in mine
        my_review = (
            db.query(Review)
            .filter_by(entity_type=etype, entity_id=eid, learner_id=learner_id)
            .first()
        )
        my_stars = my_review.stars if my_review else None
    return {
        **_counts(db, etype, eid),
        **_rating_stats(db, etype, eid),
        "liked_by_me": liked,
        "shared_by_me": shared,
        "my_stars": my_stars,
        "comments": [
            {
                "id": c.id,
                "learner_id": l.id,
                "handle": l.handle,
                "name": l.name,
                "body": c.body,
                "created_at": c.created_at,
            }
            for c, l in comments
        ],
    }


@router.post("/{etype}/{eid}/comments", status_code=201)
def add_comment(etype: str, eid: int, payload: CommentIn, db: Session = Depends(get_db)):
    entity = _check_entity(db, etype, eid)
    author = db.get(Learner, payload.learner_id)
    if not author:
        raise HTTPException(status_code=404, detail="Learner not found")
    db.add(Comment(entity_type=etype, entity_id=eid, learner_id=author.id, body=payload.body.strip()))

    owner_id, title = _owner_of(entity)
    if owner_id and owner_id != author.id:
        link = f"/formations/{eid}" if etype == "formation" else f"/courses/{eid}"
        notify(
            db, [owner_id],
            kind="comment",
            title=f"💬 {author.name or author.handle} commented on {title}",
            body=payload.body.strip()[:120],
            link=link,
        )
    db.commit()
    return {"ok": True}


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    c = db.get(Comment, comment_id)
    if not c:
        return
    viewer = db.get(Learner, learner_id) if learner_id else None
    is_admin = (settings.admin_token and x_admin_token == settings.admin_token) or (
        viewer and viewer.role in ("admin", "hr", "hr_lead")
    )
    if not (is_admin or (viewer and c.learner_id == viewer.id)):
        raise HTTPException(status_code=403, detail="Only the author, HR or an admin can delete this.")
    db.delete(c)
    db.commit()


@router.post("/{etype}/{eid}/like")
def toggle_like(etype: str, eid: int, payload: ActorIn, db: Session = Depends(get_db)):
    _check_entity(db, etype, eid)
    existing = (
        db.query(Engagement)
        .filter_by(entity_type=etype, entity_id=eid, learner_id=payload.learner_id, kind="like")
        .first()
    )
    if existing:
        db.delete(existing)
    else:
        db.add(Engagement(entity_type=etype, entity_id=eid, learner_id=payload.learner_id, kind="like"))
    db.commit()
    return {**_counts(db, etype, eid), "liked_by_me": not existing}


@router.post("/{etype}/{eid}/share")
def record_share(etype: str, eid: int, payload: ActorIn, db: Session = Depends(get_db)):
    """The UI copies the link; this records who shared what (idempotent)."""
    _check_entity(db, etype, eid)
    exists = (
        db.query(Engagement)
        .filter_by(entity_type=etype, entity_id=eid, learner_id=payload.learner_id, kind="share")
        .first()
    )
    if not exists:
        db.add(Engagement(entity_type=etype, entity_id=eid, learner_id=payload.learner_id, kind="share"))
        db.commit()
    return {**_counts(db, etype, eid), "shared_by_me": True}

@router.post("/{etype}/{eid}/rate")
def rate_entity(etype: str, eid: int, payload: RatingIn, db: Session = Depends(get_db)):
    _check_entity(db, etype, eid)
    existing = (
        db.query(Review)
        .filter_by(entity_type=etype, entity_id=eid, learner_id=payload.learner_id)
        .first()
    )
    if existing:
        existing.stars = payload.stars
    else:
        db.add(Review(entity_type=etype, entity_id=eid, learner_id=payload.learner_id, stars=payload.stars))

    # Feedback can be the last outstanding step. Rolling the enrollment here
    # means the learner sees 100% the moment they rate, instead of having to
    # revisit a lesson to make the bar move.
    completed_now = _settle_feedback_step(db, etype, eid, payload.learner_id)
    db.commit()
    return {
        **_rating_stats(db, etype, eid),
        "my_stars": payload.stars,
        "completed_now": completed_now,
    }


def _settle_feedback_step(db: Session, etype: str, eid: int, learner_id: int) -> bool:
    """Mark the enrollment complete when feedback was the only thing missing."""
    if etype != "formation":
        return False
    formation = db.get(Formation, eid)
    if not formation or not formation.require_feedback:
        return False
    enrollment = (
        db.query(FormationEnrollment)
        .filter_by(formation_id=eid, learner_id=learner_id)
        .first()
    )
    if not enrollment or enrollment.status == "completed":
        return False
    ids = set(lesson_ids(formation.curriculum))
    done = {
        r.lesson_id
        for r in db.query(FormationLessonCompletion).filter_by(
            learner_id=learner_id, formation_id=eid
        )
    }
    if ids and ids.issubset(done):
        enrollment.status = "completed"
        return True
    return False
