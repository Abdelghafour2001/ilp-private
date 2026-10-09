import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.i18n import SUPPORTED_LOCALES
from app.db.session import get_db
from app.labs import gamification, registry
from app.labs import progress_service
from app.models import (
    Achievement,
    Formation,
    FormationLessonCompletion,
    Learner,
    StepCompletion,
    Team,
)
from app.schemas.formation import iter_lessons
from app.schemas.learner import (
    LeaderboardEntry,
    LearnerCreate,
    LearnerOut,
    LearnerProfile,
    RecentActivity,
)

router = APIRouter(tags=["learners"])


@router.post("/learners", response_model=LearnerOut, status_code=201)
def create_or_get(payload: LearnerCreate, db: Session = Depends(get_db)):
    """Sign in by handle or work email, or claim a new handle.

    Lightweight identity: no password. The browser keeps the returned id.

    An email is only ever a lookup, never a claim. Typing an address that does
    not exist used to create an account whose handle *was* that address, which
    is how a roster grows a second, empty copy of somebody who already had one.
    """
    entered = payload.handle.strip()
    if not entered:
        raise HTTPException(status_code=400, detail="Enter a handle or your work email.")

    existing = (
        db.query(Learner)
        .filter((Learner.handle.ilike(entered)) | (Learner.email.ilike(entered)))
        .first()
    )
    if existing:
        return existing
    if "@" in entered:
        raise HTTPException(status_code=404, detail=f"No account for {entered}.")

    learner = Learner(handle=entered)
    db.add(learner)
    db.commit()
    db.refresh(learner)
    return learner


class LocaleRequest(BaseModel):
    locale: str  # fr | en


@router.post("/learners/{learner_id}/locale", response_model=LearnerOut)
def set_locale(learner_id: int, payload: LocaleRequest, db: Session = Depends(get_db)):
    """Remember someone's language so their emails and notifications match the
    interface they chose."""
    learner = db.get(Learner, learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    if payload.locale not in SUPPORTED_LOCALES:
        raise HTTPException(
            status_code=400,
            detail=f"Locale must be one of: {', '.join(SUPPORTED_LOCALES)}.",
        )
    learner.locale = payload.locale
    db.commit()
    db.refresh(learner)
    return learner


def _step_titles(db: Session) -> dict[tuple[str, str], tuple[str, str]]:
    out: dict[tuple[str, str], tuple[str, str]] = {}
    for lab in registry.all_labs(db):
        for step in lab.steps:
            out[(lab.id, step.id)] = (lab.title, step.title)
    return out


def _can_see_matricule(viewer: Learner | None) -> bool:
    return viewer is not None and viewer.role in ("hr", "hr_lead", "admin")


@router.get("/learners/{learner_id}", response_model=LearnerProfile)
def profile(
    learner_id: int,
    viewer_id: int | None = None,
    db: Session = Depends(get_db),
):
    learner = db.get(Learner, learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    viewer = db.get(Learner, viewer_id) if viewer_id else None
    # Idempotent, and it is what makes a provider-earned badge appear without
    # waiting for the nightly job: most of these are won away from this app.
    progress_service.sync_badges(db, learner)
    completions = (
        db.query(StepCompletion)
        .filter(StepCompletion.learner_id == learner_id)
        .order_by(StepCompletion.created_at.desc())
        .all()
    )
    completed = [f"{c.lab_id}:{c.step_id}" for c in completions]
    badges = [
        a.badge_id
        for a in db.query(Achievement).filter(Achievement.learner_id == learner_id)
    ]
    titles = _step_titles(db)
    recent = []
    for c in completions[:8]:
        lab_title, step_title = titles.get((c.lab_id, c.step_id), (c.lab_id, c.step_id))
        recent.append(
            RecentActivity(
                lab_id=c.lab_id,
                lab_title=lab_title,
                step_title=step_title,
                xp=c.xp_awarded,
                at=c.created_at.isoformat() if c.created_at else "",
            )
        )

    lvl = gamification.level_info(learner.xp)
    return LearnerProfile(
        id=learner.id,
        handle=learner.handle,
        name=learner.name,
        xp=learner.xp,
        role=learner.role,
        onboarded=learner.onboarded,
        bu=learner.bu,
        practice=learner.practice,
        location=learner.location,
        matricule=learner.matricule if _can_see_matricule(viewer) else None,
        job_level=learner.job_level,
        completed_steps=completed,
        badges=badges,
        current_streak=gamification.streak_is_live(learner),
        longest_streak=learner.longest_streak or 0,
        recent=recent,
        **lvl,
    )


@router.get("/learners/{learner_id}/quests")
def quests(learner_id: int, db: Session = Depends(get_db)):
    learner = db.get(Learner, learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    return gamification.weekly_quests(db, learner)


@router.get("/tracks")
def tracks(learner_id: int | None = None, db: Session = Depends(get_db)):
    """Skill tree: tracks with per-lab + per-track progress (for a learner if given)."""
    learner = db.get(Learner, learner_id) if learner_id else None
    return {"tracks": gamification.skill_tree(db, learner)}


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def leaderboard(
    limit: int = 20,
    team_id: int | None = None,
    days: int | None = None,
    db: Session = Depends(get_db),
):
    """Top learners. Filters: `team_id` restricts to one team; `days` ranks by
    XP earned in the window (lab steps + training lessons) instead of all-time."""
    q = db.query(Learner)
    if team_id:
        q = q.filter(Learner.team_id == team_id)
    learners = q.all()

    window_xp: dict[int, int] | None = None
    if days:
        since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=max(1, min(days, 365)))
        window_xp = defaultdict(int)
        for lid, s in (
            db.query(StepCompletion.learner_id, func.coalesce(func.sum(StepCompletion.xp_awarded), 0))
            .filter(StepCompletion.created_at >= since)
            .group_by(StepCompletion.learner_id)
        ):
            window_xp[lid] += int(s)
        # Training-lesson XP lives in each formation's curriculum, not the row.
        rows = (
            db.query(FormationLessonCompletion)
            .filter(FormationLessonCompletion.created_at >= since)
            .all()
        )
        if rows:
            xp_by_formation: dict[int, dict[str, int]] = {}
            for f in db.query(Formation).filter(
                Formation.id.in_({r.formation_id for r in rows})
            ):
                xp_by_formation[f.id] = {
                    l["id"]: l.get("xp", 10) for l in iter_lessons(f.curriculum)
                }
            for r in rows:
                window_xp[r.learner_id] += xp_by_formation.get(r.formation_id, {}).get(r.lesson_id, 0)

    if window_xp is not None:
        learners = [l for l in learners if window_xp.get(l.id, 0) > 0]
        learners.sort(key=lambda l: window_xp[l.id], reverse=True)  # type: ignore[index]
    else:
        learners = [l for l in learners if l.xp > 0]
        learners.sort(key=lambda l: l.xp, reverse=True)
    learners = learners[: max(1, min(limit, 100))]

    badge_counts = dict(
        db.query(Achievement.learner_id, func.count()).group_by(Achievement.learner_id)
    )
    team_names = {t.id: t.name for t in db.query(Team)}
    entries = []
    for learner in learners:
        lvl = gamification.level_info(learner.xp)
        entries.append(
            LeaderboardEntry(
                handle=learner.handle,
                name=learner.name,
                team_id=learner.team_id,
                team_name=team_names.get(learner.team_id, "") if learner.team_id else "",
                xp=window_xp[learner.id] if window_xp is not None else learner.xp,
                badges=badge_counts.get(learner.id, 0),
                level=lvl["level"],
                level_title=lvl["level_title"],
                current_streak=gamification.streak_is_live(learner),
            )
        )
    return entries
