"""Gamification engine: levels, streaks, weekly quests, and the skill tree.

Pure-ish helpers used by the learners API and the progress service. Leveling is
a closed-form XP curve; streaks are maintained on the Learner row; quests and the
skill tree are derived from step completions + the lab registry.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from app.labs import registry
from app.models import Learner, StepCompletion

# --------------------------------------------------------------------------- #
# Levels                                                                       #
# --------------------------------------------------------------------------- #
# Cumulative XP needed to *reach* level L is 50*L*(L-1):
#   L1=0, L2=100, L3=300, L4=600, L5=1000, L6=1500, ...
# A smooth, ever-steepening curve that feels rewarding early and meaningful later.

_TITLES = [
    (1, "Novice"),
    (3, "Apprentice"),
    (5, "Practitioner"),
    (7, "Engineer"),
    (9, "Specialist"),
    (12, "Expert"),
    (15, "Architect"),
    (20, "Luminary"),
]


def _xp_for_level(level: int) -> int:
    return 50 * level * (level - 1)


def level_title(level: int) -> str:
    title = _TITLES[0][1]
    for threshold, name in _TITLES:
        if level >= threshold:
            title = name
    return title


def level_info(xp: int) -> dict:
    """Resolve XP into a level + progress toward the next level."""
    level = 1
    while _xp_for_level(level + 1) <= xp:
        level += 1
    base = _xp_for_level(level)
    nxt = _xp_for_level(level + 1)
    span = nxt - base
    into = xp - base
    return {
        "level": level,
        "level_title": level_title(level),
        "xp_into_level": into,
        "xp_for_level": span,
        "xp_to_next": nxt - xp,
        "level_pct": round(100 * into / span) if span else 100,
    }


# --------------------------------------------------------------------------- #
# Streaks                                                                      #
# --------------------------------------------------------------------------- #


def touch_streak(learner: Learner, *, today: dt.date | None = None) -> None:
    """Update the learner's daily streak for activity happening `today`.

    Call when a learner makes meaningful progress (passes a new step). Idempotent
    within a single day. Mutates the learner; the caller commits.
    """
    today = today or dt.date.today()
    last = learner.last_active_on
    if last == today:
        return  # already counted today
    if last == today - dt.timedelta(days=1):
        learner.current_streak += 1
    else:
        learner.current_streak = 1
    learner.last_active_on = today
    learner.longest_streak = max(learner.longest_streak or 0, learner.current_streak)


def streak_is_live(learner: Learner, *, today: dt.date | None = None) -> int:
    """The streak as it should display now (0 if they missed yesterday+today)."""
    today = today or dt.date.today()
    last = learner.last_active_on
    if last in (today, today - dt.timedelta(days=1)):
        return learner.current_streak
    return 0


# --------------------------------------------------------------------------- #
# Weekly quests                                                                #
# --------------------------------------------------------------------------- #


def _week_start(today: dt.date | None = None) -> dt.datetime:
    today = today or dt.date.today()
    monday = today - dt.timedelta(days=today.weekday())
    return dt.datetime.combine(monday, dt.time.min)


def weekly_quests(db: Session, learner: Learner) -> dict:
    """A fresh set of weekly goals + the learner's progress this ISO week."""
    week_start = _week_start()
    rows = (
        db.query(StepCompletion)
        .filter(
            StepCompletion.learner_id == learner.id,
            StepCompletion.created_at >= week_start,
        )
        .all()
    )

    # Step type/grader lookup from the registry.
    idx: dict[tuple[str, str], object] = {}
    for lab in registry.all_labs(db):
        for step in lab.steps:
            idx[(lab.id, step.id)] = step

    steps_this_week = len(rows)
    xp_this_week = sum(r.xp_awarded for r in rows)
    labs_touched = len({r.lab_id for r in rows})
    sql_this_week = sum(
        1 for r in rows if (s := idx.get((r.lab_id, r.step_id))) and s.grader.type == "sql_scalar"
    )

    quests = [
        {"id": "daily", "title": "Keep the pace", "description": "Pass 5 steps this week",
         "icon": "bolt", "progress": min(steps_this_week, 5), "target": 5},
        {"id": "xp", "title": "XP sprint", "description": "Earn 100 XP this week",
         "icon": "flame", "progress": min(xp_this_week, 100), "target": 100},
        {"id": "sql", "title": "Query master", "description": "Solve 2 SQL exercises",
         "icon": "playground", "progress": min(sql_this_week, 2), "target": 2},
        {"id": "explore", "title": "Explorer", "description": "Work across 2 different labs",
         "icon": "labs", "progress": min(labs_touched, 2), "target": 2},
    ]
    for q in quests:
        q["done"] = q["progress"] >= q["target"]

    return {
        "week_start": week_start.date().isoformat(),
        "completed": sum(1 for q in quests if q["done"]),
        "total": len(quests),
        "quests": quests,
    }


# --------------------------------------------------------------------------- #
# Skill tree (tracks with progress)                                            #
# --------------------------------------------------------------------------- #

_DIFFICULTY_ORDER = {"beginner": 0, "intermediate": 1, "advanced": 2}


def skill_tree(db: Session, learner: Learner | None = None) -> list[dict]:
    """Tracks → labs with per-lab + per-track completion, for the skill-tree UI."""
    done: set[tuple[str, str]] = set()
    if learner is not None:
        done = {
            (c.lab_id, c.step_id)
            for c in db.query(StepCompletion).filter(StepCompletion.learner_id == learner.id)
        }

    by_track: dict[str, list] = {}
    for lab in registry.all_labs(db):
        by_track.setdefault(lab.track, []).append(lab)

    tracks: list[dict] = []
    for track, labs in sorted(by_track.items()):
        labs = sorted(labs, key=lambda l: _DIFFICULTY_ORDER.get(l.difficulty, 1))
        lab_views = []
        track_required = 0
        track_done = 0
        track_total_xp = 0
        track_earned_xp = 0
        for lab in labs:
            gradable = [s for s in lab.steps if s.grader.type]
            comp = sum(1 for s in gradable if (lab.id, s.id) in done)
            earned = sum(s.xp for s in gradable if (lab.id, s.id) in done)
            track_required += len(gradable)
            track_done += comp
            track_total_xp += lab.total_xp
            track_earned_xp += earned
            lab_views.append(
                {
                    "id": lab.id,
                    "title": lab.title,
                    "difficulty": lab.difficulty,
                    "total_steps": len(gradable),
                    "completed_steps": comp,
                    "total_xp": lab.total_xp,
                    "done": bool(gradable) and comp == len(gradable),
                }
            )
        tracks.append(
            {
                "track": track,
                "labs": lab_views,
                "total_steps": track_required,
                "completed_steps": track_done,
                "total_xp": track_total_xp,
                "earned_xp": track_earned_xp,
                "pct": round(100 * track_done / track_required) if track_required else 0,
                "done": track_required > 0 and track_done == track_required,
            }
        )
    return tracks
