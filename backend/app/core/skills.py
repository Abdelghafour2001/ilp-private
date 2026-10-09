"""Skill levels: what someone's level actually is, and what it should be.

Two questions the rest of the app asks:

* **What level is this person at?** Several people may have an opinion, and
  they are not equally informative. `effective_level` picks the most
  authoritative available (assessment > manager > peers > self) and always
  reports the provenance, so a screen can show *who said so* rather than an
  unexplained number.

* **What level should they be at?** A `SkillProfile` attached to their role
  supplies the target; the difference is the gap, and the gap is the thing
  that turns a matrix into a training plan.
"""

from collections import defaultdict

from sqlalchemy.orm import Session

from app.models import (
    Learner,
    LearnerSkill,
    SkillProfile,
    SkillProfileTarget,
    SkillRating,
)
from app.models.skill_profile import SOURCE_AUTHORITY


def resolve_profile(db: Session, learner: Learner) -> SkillProfile | None:
    """The role profile that applies to a learner.

    An explicit assignment wins. Otherwise the best match on the org axes we
    already collect, preferring the most specific: practice + job level beats
    either alone, which beats a catch-all.
    """
    if learner.skill_profile_id:
        explicit = db.get(SkillProfile, learner.skill_profile_id)
        if explicit:
            return explicit

    candidates = [
        p
        for p in db.query(SkillProfile).all()
        if (not p.practice or p.practice == learner.practice)
        and (not p.job_level or p.job_level == learner.job_level)
    ]
    if not candidates:
        return None
    # Most specific first: a profile that pins both axes is a better fit than
    # one that pins neither.
    candidates.sort(key=lambda p: (bool(p.practice) + bool(p.job_level)), reverse=True)
    return candidates[0]


def targets_for(db: Session, profile: SkillProfile | None) -> dict[int, int]:
    """skill_id -> expected level for a profile."""
    if not profile:
        return {}
    return {
        t.skill_id: t.target_level
        for t in db.query(SkillProfileTarget).filter_by(profile_id=profile.id)
    }


def ratings_for(db: Session, learner_ids: list[int]) -> dict[tuple[int, int], dict]:
    """(learner_id, skill_id) -> every rating, grouped by source.

    Returns raw material; `effective_level` turns it into one number.
    """
    out: dict[tuple[int, int], dict] = defaultdict(
        lambda: {"self": None, "peer": [], "manager": None, "assessment": None}
    )
    if not learner_ids:
        return out

    # The learner's own rating still lives on LearnerSkill, so existing screens
    # keep working; treat it as the "self" source.
    for ls in db.query(LearnerSkill).filter(LearnerSkill.learner_id.in_(learner_ids)):
        if ls.level:
            out[(ls.learner_id, ls.skill_id)]["self"] = ls.level

    for r in db.query(SkillRating).filter(SkillRating.learner_id.in_(learner_ids)):
        bucket = out[(r.learner_id, r.skill_id)]
        if r.source == "peer":
            bucket["peer"].append(r.level)
        elif r.source in ("manager", "assessment", "self"):
            # Keep the highest when several exist (e.g. two managers).
            current = bucket.get(r.source)
            bucket[r.source] = max(current or 0, r.level)
    return out


def effective_level(bucket: dict) -> tuple[int, str]:
    """One level plus the source it came from.

    Authority order, not an average: an exam result should not be dragged down
    by an out-of-date self-assessment. Peers are averaged among themselves
    because no single colleague is authoritative.
    """
    if bucket.get("assessment"):
        return bucket["assessment"], "assessment"
    if bucket.get("manager"):
        return bucket["manager"], "manager"
    peers = bucket.get("peer") or []
    if peers:
        return round(sum(peers) / len(peers)), "peer"
    if bucket.get("self"):
        return bucket["self"], "self"
    return 0, "none"


def skill_state(
    db: Session, learner: Learner, skill_ids: list[int] | None = None
) -> dict[int, dict]:
    """Per-skill level, source, target and gap for one person."""
    profile = resolve_profile(db, learner)
    targets = targets_for(db, profile)
    buckets = ratings_for(db, [learner.id])

    ids = set(skill_ids or [])
    ids |= {sid for (_, sid) in buckets}
    ids |= set(targets)

    state: dict[int, dict] = {}
    for sid in ids:
        bucket = buckets.get((learner.id, sid)) or {
            "self": None, "peer": [], "manager": None, "assessment": None
        }
        level, source = effective_level(bucket)
        target = targets.get(sid)
        state[sid] = {
            "level": level,
            "source": source,
            "self": bucket.get("self") or 0,
            "peers": len(bucket.get("peer") or []),
            "manager": bucket.get("manager") or 0,
            "assessment": bucket.get("assessment") or 0,
            "target": target,
            # Positive = short of target. None when the role sets no target,
            # which is different from a gap of zero.
            "gap": (target - level) if target is not None else None,
        }
    return state


def sort_authority(source: str) -> int:
    return SOURCE_AUTHORITY.get(source, -1)
