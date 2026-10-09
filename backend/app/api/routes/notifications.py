"""Per-learner notification inbox: list latest, unread count, mark read."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Learner, Notification
from app.schemas.notification import NotificationList, NotificationOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


class MarkReadRequest(BaseModel):
    learner_id: int
    ids: list[int] = []  # empty = mark everything read


@router.get("", response_model=NotificationList)
def list_notifications(learner_id: int, limit: int = 30, db: Session = Depends(get_db)):
    if not db.get(Learner, learner_id):
        raise HTTPException(status_code=404, detail="Learner not found")
    rows = (
        db.query(Notification)
        .filter(Notification.learner_id == learner_id)
        .order_by(Notification.id.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    unread = (
        db.query(Notification)
        .filter(Notification.learner_id == learner_id, Notification.read.is_(False))
        .count()
    )
    return NotificationList(
        unread=unread,
        items=[NotificationOut.model_validate(r, from_attributes=True) for r in rows],
    )


@router.post("/read")
def mark_read(payload: MarkReadRequest, db: Session = Depends(get_db)):
    q = db.query(Notification).filter(
        Notification.learner_id == payload.learner_id, Notification.read.is_(False)
    )
    if payload.ids:
        q = q.filter(Notification.id.in_(payload.ids))
    updated = q.update({"read": True}, synchronize_session=False)
    db.commit()
    return {"marked": updated}
