from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models import Challenge, ChallengeSubmission, ChallengeVote, Learner
from app.schemas.challenge import (
    ChallengeUpdate,
    ChallengeCreate,
    ChallengeDetail,
    ChallengeSummary,
    SubmissionCreate,
    SubmissionOut,
)

router = APIRouter(tags=["challenges"])


def _resolve_author(db: Session, learner_id: int | None, author: str | None) -> str:
    if author:
        return author.strip()
    if learner_id:
        learner = db.get(Learner, learner_id)
        if learner:
            return learner.handle
    return "anonymous"


def _can_edit(obj, learner_id: int | None, token: str | None) -> bool:
    is_admin = settings.admin_token and token == settings.admin_token
    is_author = obj.learner_id is not None and obj.learner_id == learner_id
    return bool(is_admin or is_author)


def _votes(db: Session, submission_id: int) -> int:
    return db.query(ChallengeVote).filter_by(submission_id=submission_id).count()


# ---- challenges ----


@router.get("/challenges", response_model=list[ChallengeSummary])
def list_challenges(status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Challenge)
    if status:
        q = q.filter(Challenge.status == status)
    return q.order_by(Challenge.id.desc()).all()


@router.post("/challenges", response_model=ChallengeSummary, status_code=201)
def create_challenge(payload: ChallengeCreate, db: Session = Depends(get_db)):
    challenge = Challenge(
        title=payload.title.strip(),
        summary=payload.summary.strip(),
        brief_md=payload.brief_md,
        theme=payload.theme,
        prize=payload.prize,
        deadline=payload.deadline,
        tags=payload.tags,
        author=_resolve_author(db, payload.learner_id, payload.author),
        learner_id=payload.learner_id,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return challenge


@router.get("/challenges/{challenge_id}", response_model=ChallengeDetail)
def get_challenge(challenge_id: int, db: Session = Depends(get_db)):
    challenge = db.get(Challenge, challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    subs = (
        db.query(ChallengeSubmission)
        .filter_by(challenge_id=challenge_id)
        .all()
    )
    out_subs = []
    for s in subs:
        so = SubmissionOut.model_validate(s)
        so.votes = _votes(db, s.id)
        out_subs.append(so)
    out_subs.sort(key=lambda s: s.votes, reverse=True)
    detail = ChallengeDetail.model_validate(challenge)
    detail.submissions = out_subs
    return detail


@router.put("/challenges/{challenge_id}", response_model=ChallengeSummary)
def update_challenge(
    challenge_id: int,
    payload: ChallengeUpdate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Correct a challenge in place.

    A brief with a wrong date or a typo used to mean deleting it and posting
    again, which also threw away the submissions and votes attached to it —
    so in practice the typo stayed.
    """
    challenge = db.get(Challenge, challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if not _can_edit(challenge, payload.learner_id, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the author or an admin can edit this.")

    for field in ("title", "summary", "brief_md", "theme", "prize", "deadline", "tags"):
        value = getattr(payload, field)
        if value is not None:
            setattr(challenge, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(challenge)
    return challenge


@router.post("/challenges/{challenge_id}/status")
def set_status(
    challenge_id: int,
    status: str,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    challenge = db.get(Challenge, challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if not _can_edit(challenge, learner_id, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the owner or an admin can change status.")
    challenge.status = "closed" if status == "closed" else "open"
    db.commit()
    return {"status": challenge.status}


@router.delete("/challenges/{challenge_id}", status_code=204)
def delete_challenge(
    challenge_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    challenge = db.get(Challenge, challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if not _can_edit(challenge, learner_id, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the owner or an admin can delete this.")
    db.delete(challenge)
    db.commit()


# ---- submissions ----


@router.post("/challenges/{challenge_id}/submissions", response_model=SubmissionOut, status_code=201)
def submit(challenge_id: int, payload: SubmissionCreate, db: Session = Depends(get_db)):
    challenge = db.get(Challenge, challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if challenge.status != "open":
        raise HTTPException(status_code=400, detail="This challenge is closed.")
    sub = ChallengeSubmission(
        challenge_id=challenge_id,
        title=payload.title.strip(),
        summary=payload.summary.strip(),
        body_md=payload.body_md,
        link=payload.link,
        author=_resolve_author(db, payload.learner_id, payload.author),
        learner_id=payload.learner_id,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    out = SubmissionOut.model_validate(sub)
    out.votes = 0
    return out


@router.post("/submissions/{submission_id}/vote")
def vote(submission_id: int, learner_id: int, db: Session = Depends(get_db)):
    """Toggle an upvote for the current learner."""
    sub = db.get(ChallengeSubmission, submission_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    existing = db.query(ChallengeVote).filter_by(submission_id=submission_id, learner_id=learner_id).first()
    if existing:
        db.delete(existing)
        voted = False
    else:
        db.add(ChallengeVote(submission_id=submission_id, learner_id=learner_id))
        voted = True
    db.commit()
    return {"votes": _votes(db, submission_id), "voted": voted}


@router.delete("/submissions/{submission_id}", status_code=204)
def delete_submission(
    submission_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    sub = db.get(ChallengeSubmission, submission_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not _can_edit(sub, learner_id, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the author or an admin can delete this.")
    db.delete(sub)
    db.commit()
