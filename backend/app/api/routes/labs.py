from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.engine import list_check_kinds
from app.labs import registry
from app.labs.badges import catalog as badge_catalog
from app.labs.grader import GradeError, grade
from app.labs.loader import public_lab
from app.labs.progress_service import record_pass
from app.models import Learner, StepCompletion
from app.schemas.learner import GradeRequest

router = APIRouter(prefix="/labs", tags=["labs"])


@router.get("")
def list_all(learner_id: int | None = None, db: Session = Depends(get_db)):
    done: set[tuple[str, str]] = set()
    if learner_id:
        done = {
            (c.lab_id, c.step_id)
            for c in db.query(StepCompletion).filter(StepCompletion.learner_id == learner_id)
        }
    labs = []
    for lab in registry.all_labs(db):
        gradable = [s for s in lab.steps if s.grader.type]
        completed = sum(1 for s in gradable if (lab.id, s.id) in done)
        labs.append(
            {
                "id": lab.id,
                "title": lab.title,
                "track": lab.track,
                "difficulty": lab.difficulty,
                "summary": lab.summary,
                "tags": lab.tags,
                "total_xp": lab.total_xp,
                "step_count": len(lab.steps),
                "gradable_count": len(gradable),
                "completed_count": completed,
            }
        )
    return labs


@router.get("/check-kinds")
def check_kinds():
    """The grader kinds a lab step can use, for the lab authoring screen.

    This used to hang off the data-quality suite builder. That tooling is gone;
    the kinds themselves grade lab steps, so they live with labs now.
    """
    return list_check_kinds()


@router.get("/badges")
def badges():
    return badge_catalog()


@router.get("/{lab_id}")
def get_one(lab_id: str, db: Session = Depends(get_db)):
    lab = registry.get_lab(db, lab_id)
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    return public_lab(lab)


@router.post("/{lab_id}/steps/{step_id}/grade")
def grade_step(
    lab_id: str, step_id: str, body: GradeRequest, db: Session = Depends(get_db)
):
    lab = registry.get_lab(db, lab_id)
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    step = next((s for s in lab.steps if s.id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    try:
        result = grade(step, body.submission, lab.dataset.schema_name, lab.dataset.table)
    except GradeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    awarded = {"awarded_xp": 0, "new_badges": []}
    learner_xp = None
    if result["passed"] and body.learner_id:
        learner = db.get(Learner, body.learner_id)
        if learner:
            awarded = record_pass(db, learner, lab_id, step_id)
            learner_xp = learner.xp

    return {**result, **awarded, "learner_xp": learner_xp}
