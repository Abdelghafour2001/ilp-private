"""Upcoming events — the cross-formation schedule of live training sessions.

Kept as a thin alias over `/training-sessions` so existing clients keep working
while the schedule gains open sessions and registration. Anyone can see the
sessions of published formations plus every open session; the viewer's own
enrollment and registration state is attached so the UI can highlight "your"
sessions.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.routes.sessions import list_sessions
from app.db.session import get_db
from app.schemas.formation import UpcomingEvent

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/upcoming", response_model=list[UpcomingEvent])
def upcoming(
    learner_id: int | None = None,
    days: int = 90,
    db: Session = Depends(get_db),
):
    return list_sessions(learner_id=learner_id, days=days, db=db)
