"""What to learn next — computed, with the reason attached."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core import recommendations
from app.db.session import get_db

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("/mine")
def mine(learner_id: int, db: Session = Depends(get_db)):
    """This learner's suggestions. Empty is a valid answer, and says so."""
    return {"items": recommendations.for_learner(db, learner_id)}
