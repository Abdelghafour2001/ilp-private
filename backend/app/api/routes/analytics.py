"""HR analytics — the KPI layer behind the /org panel.

One endpoint returns: org totals, per-content engagement (subscribers,
comments, likes, shares, learning hours, owner & editors) and per-collaborator
activity (courses/trainings followed, hours, comments, likes, shares).

Learning time comes from two sources:

* **measured** — a confirmed présence at a live session contributes the
  session's scheduled duration. This is real, defensible time.
* **estimated** — completed content: training lessons use their authored
  duration, course lessons and lab steps use flat constants
  (COURSE_LESSON_MIN / LAB_STEP_MIN).

* **external** — work done on Coursera & co. Coursera's enrollment report
  carries hours the learner actually spent, so those are measured; a provider
  that reports only progress falls back to published course length pro-rated by
  that progress, which is an estimate. `external_measured_hours` says how much
  of the external total is the solid kind.
* **declared** — what someone logged themselves: an article, a book, a
  conference, an afternoon of mentoring. Self-declared, optionally verified by
  a manager, and reported separately for that reason.

Jour-Homme is that total divided by `HOURS_PER_MAN_DAY`, so it inherits the
estimates' caveat. `session_hours`, `external_hours` and `declared_hours` report each
share separately, so a reader can tell how solid a figure is.
`external_unmatched` counts provider accounts we could not tie to anyone here —
if it is not near zero, the totals understate reality.

Visibility follows the governance model: an L&D/admin viewer sees the whole
organisation, while an HRBP (`hr`) sees only their own BU.

Money is not reported here at all. Training spend was shown to L&D and hidden
from everyone else; it is now out of the product entirely, so no screen, export
or chart carries a price. The `cost` columns survive in the database untouched
— dropping them would lose data nobody asked to delete — but nothing reads them.
"""

import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exporters import Chart, build_pdf, build_xlsx
from app.core.rbac import (
    Scope,
    bu_head_for,
    hr_perimeter,
    is_admin_token,
    reporting_scope,
)
from app.labs import gamification
from app.db.session import get_db
from app.models import (
    BusinessUnit,
    Comment,
    ContentEditor,
    Course,
    CourseLessonCompletion,
    EarnedCertificate,
    Engagement,
    ExternalEnrollment,
    HrBuAssignment,
    LearningRecord,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    FormationSession,
    Learner,
    Review,
    SessionRegistration,
    Skill,
    SkillLink,
    StepCompletion,
    Team,
)
from app.schemas.formation import iter_lessons

router = APIRouter(prefix="/analytics", tags=["analytics"])

COURSE_LESSON_MIN = 6  # flat estimate — course lessons carry no duration
LAB_STEP_MIN = 5


def _require_hr(db: Session, learner_id: int | None, token: str | None) -> Scope:
    """Authorise the viewer and return the slice of the org they may see.

    Perimeters live in `app.core.rbac` so every reporting surface agrees on who
    sees what — the audit found this logic duplicated with subtle differences.
    """
    if is_admin_token(token):
        return reporting_scope(db, None, token)

    viewer = db.get(Learner, learner_id) if learner_id else None

    # Local-dev convenience: with NEITHER auth mechanism configured and no
    # viewer, the API answers openly. This payload carries matricules and job
    # levels, so the fallback needs both gates down.
    if (
        viewer is None
        and not settings.require_admin_auth
        and not settings.admin_token
        and not settings.auth_enabled
        and not learner_id
    ):
        return Scope(None, "Toute l'organisation (dev)")

    scope = reporting_scope(db, viewer, token)
    if viewer is None or (scope.learner_ids is not None and not scope.learner_ids
                          and viewer.role not in ("hr", "hr_lead", "admin")):
        raise HTTPException(status_code=403, detail="Only HR or admins can view analytics.")
    return scope


@router.get("/hr")
def hr_analytics(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    scope = _require_hr(db, learner_id, x_admin_token)

    learner_q = db.query(Learner)
    if scope.learner_ids is not None:
        learner_q = learner_q.filter(Learner.id.in_(scope.learner_ids or {0}))
    learners = {l.id: l for l in learner_q.all()}
    in_scope = scope.allows

    teams = {t.id: t.name for t in db.query(Team).all()}
    formations = db.query(Formation).all()
    courses = db.query(Course).all()

    # ---- engagement & comments, grouped by entity --------------------------
    eng: dict[tuple[str, int], dict[str, int]] = defaultdict(lambda: {"like": 0, "share": 0})
    likes_given: dict[int, int] = defaultdict(int)
    shares_given: dict[int, int] = defaultdict(int)
    for e in db.query(Engagement):
        if not in_scope(e.learner_id):
            continue
        eng[(e.entity_type, e.entity_id)][e.kind] += 1
        (likes_given if e.kind == "like" else shares_given)[e.learner_id] += 1

    comment_counts: dict[tuple[str, int], int] = defaultdict(int)
    comments_by_learner: dict[int, int] = defaultdict(int)
    for c in db.query(Comment):
        if not in_scope(c.learner_id):
            continue
        comment_counts[(c.entity_type, c.entity_id)] += 1
        comments_by_learner[c.learner_id] += 1

    editors: dict[tuple[str, int], list[str]] = defaultdict(list)
    for ed in db.query(ContentEditor).order_by(ContentEditor.updated_at.desc()):
        if not in_scope(ed.learner_id):
            continue
        editors[(ed.entity_type, ed.entity_id)].append(ed.name or str(ed.learner_id))

    stars_by_content: dict[tuple[str, int], list[int]] = defaultdict(list)
    reviewers_by_content: dict[tuple[str, int], set[int]] = defaultdict(set)
    for r in db.query(Review):
        if not in_scope(r.learner_id):
            continue
        stars_by_content[(r.entity_type, r.entity_id)].append(r.stars)
        reviewers_by_content[(r.entity_type, r.entity_id)].add(r.learner_id)

    # ---- learning minutes, per content and per learner ---------------------
    minutes_by_content: dict[tuple[str, int], int] = defaultdict(int)
    minutes_by_learner: dict[int, int] = defaultdict(int)
    lessons_done: dict[int, int] = defaultdict(int)

    duration_of = {
        f.id: {l["id"]: l.get("duration_min", 5) for l in iter_lessons(f.curriculum)}
        for f in formations
    }
    f_followers: dict[int, set[int]] = defaultdict(set)
    f_completed: dict[int, int] = defaultdict(int)
    trainings_followed: dict[int, int] = defaultdict(int)
    for enr in db.query(FormationEnrollment).filter(
        FormationEnrollment.status.in_(("active", "completed"))
    ):
        if not in_scope(enr.learner_id):
            continue
        f_followers[enr.formation_id].add(enr.learner_id)
        trainings_followed[enr.learner_id] += 1
        if enr.status == "completed":
            f_completed[enr.formation_id] += 1

    for r in db.query(FormationLessonCompletion):
        if not in_scope(r.learner_id):
            continue
        mins = duration_of.get(r.formation_id, {}).get(r.lesson_id, 5)
        minutes_by_content[("formation", r.formation_id)] += mins
        minutes_by_learner[r.learner_id] += mins
        lessons_done[r.learner_id] += 1

    c_followers: dict[int, set[int]] = defaultdict(set)
    for r in db.query(CourseLessonCompletion):
        if not in_scope(r.learner_id):
            continue
        minutes_by_content[("course", r.course_id)] += COURSE_LESSON_MIN
        minutes_by_learner[r.learner_id] += COURSE_LESSON_MIN
        lessons_done[r.learner_id] += 1
        c_followers[r.course_id].add(r.learner_id)

    for lid, n in (
        db.query(StepCompletion.learner_id, func.count()).group_by(StepCompletion.learner_id)
    ):
        if not in_scope(lid):
            continue
        minutes_by_learner[lid] += n * LAB_STEP_MIN
        lessons_done[lid] += n

    # ---- external platforms (Coursera & co.) --------------------------------
    # An external course used to contribute nothing, so anyone learning on
    # Coursera looked idle. Where the provider reports time actually spent we
    # take it as-is; where it reports only progress we credit published course
    # length pro-rated by that progress, and label the result an estimate.
    external_minutes_by_learner: dict[int, int] = defaultdict(int)
    external_measured_minutes_by_learner: dict[int, int] = defaultdict(int)
    external_by_learner: dict[int, int] = defaultdict(int)
    # The provider's own outcome figures, kept per person so a reader can put
    # "what they did here" beside "what they did on Coursera" instead of seeing
    # one blended hour count that answers neither question.
    external_done_by_learner: dict[int, int] = defaultdict(int)
    external_certs_by_learner: dict[int, int] = defaultdict(int)
    external_last_by_learner: dict[int, dt.date] = {}
    external_email_by_learner: dict[int, str] = {}
    external_unmatched = 0
    for row in db.query(ExternalEnrollment):
        if row.learner_id is None:
            # Nobody here owns this provider account — count it so the gap is
            # visible instead of quietly shrinking the totals.
            external_unmatched += 1
            continue
        if not in_scope(row.learner_id):
            continue
        # Measured hours are already time spent — pro-rating them by progress
        # would discount a learner twice for not having finished yet.
        if row.hours_measured:
            share = 1.0
        else:
            share = 1.0 if row.completed else max(0, min(row.progress_pct, 100)) / 100
        minutes = int(round((row.hours or 0) * 60 * share))
        external_minutes_by_learner[row.learner_id] += minutes
        if row.hours_measured:
            external_measured_minutes_by_learner[row.learner_id] += minutes
        minutes_by_learner[row.learner_id] += minutes
        external_by_learner[row.learner_id] += 1
        external_done_by_learner[row.learner_id] += int(row.completed)
        external_certs_by_learner[row.learner_id] += int(bool(row.certificate_url))
        if row.matched_email:
            external_email_by_learner[row.learner_id] = row.matched_email
        last = row.last_activity_at or row.completed_at
        if last:
            seen = external_last_by_learner.get(row.learner_id)
            if seen is None or last.date() > seen:
                external_last_by_learner[row.learner_id] = last.date()
        if row.course_id:
            minutes_by_content[("course", row.course_id)] += minutes
            c_followers[row.course_id].add(row.learner_id)

    # ---- self-reported learning --------------------------------------------
    # Declared, not observed. Weaker evidence than a session register, so it
    # gets its own bucket rather than being blended into measured time.
    declared_minutes_by_learner: dict[int, int] = defaultdict(int)
    declared_records_by_learner: dict[int, int] = defaultdict(int)
    declared_verified = 0
    for rec in db.query(LearningRecord):
        if not in_scope(rec.learner_id):
            continue
        declared_minutes_by_learner[rec.learner_id] += rec.minutes or 0
        declared_records_by_learner[rec.learner_id] += 1
        minutes_by_learner[rec.learner_id] += rec.minutes or 0
        if rec.verified_by_id:
            declared_verified += 1

    certs_by_learner = {
        lid: n
        for lid, n in db.query(EarnedCertificate.learner_id, func.count()).group_by(
            EarnedCertificate.learner_id
        )
        if in_scope(lid)
    }

    # ---- attendance (présence) + the time it represents ---------------------
    # Only marked registrations count, so an un-taken register reads as "no
    # data" rather than as an absence.
    #
    # Attending a session is also the most *reliable* learning time we have:
    # its duration is scheduled, not estimated. A 3-hour classroom workshop is
    # exactly the kind of time an HR Jour-Homme figure is expected to include,
    # so a confirmed présence adds the session's real duration to the totals.
    sessions_by_id = {
        s.id: s for s in db.query(FormationSession).all()
    }
    present_by_content: dict[tuple[str, int], int] = defaultdict(int)
    marked_by_content: dict[tuple[str, int], int] = defaultdict(int)
    present_by_learner: dict[int, int] = defaultdict(int)
    marked_by_learner: dict[int, int] = defaultdict(int)
    session_minutes_by_learner: dict[int, int] = defaultdict(int)
    for reg in db.query(SessionRegistration).filter(SessionRegistration.attended.isnot(None)):
        if not in_scope(reg.learner_id):
            continue
        session = sessions_by_id.get(reg.session_id)
        marked_by_learner[reg.learner_id] += 1
        if reg.attended:
            present_by_learner[reg.learner_id] += 1
            minutes = session.duration_min if session else 0
            session_minutes_by_learner[reg.learner_id] += minutes
            minutes_by_learner[reg.learner_id] += minutes
            if session and session.formation_id:
                minutes_by_content[("formation", session.formation_id)] += minutes
        fid = session.formation_id if session else None
        if fid:
            marked_by_content[("formation", fid)] += 1
            if reg.attended:
                present_by_content[("formation", fid)] += 1

    def _rate(part: int, whole: int) -> float | None:
        return round(part / whole * 100, 1) if whole else None

    # ---- content rows -------------------------------------------------------
    def content_row(etype: str, eid: int, title: str, emoji: str, owner: str,
                    subscribers: int, completed: int | None,
                    fmt: str = "", source: str = "internal", provider: str = "",
                    level: str = "", lessons: int = 0, planned_hours: float = 0.0,
                    objectives: list | None = None, prerequisites: str = "",
                    skills: list | None = None, sessions_held: int = 0,
                    summary: str = ""):
        key = (etype, eid)
        stars = stars_by_content.get(key, [])
        reviewers = len(reviewers_by_content.get(key, ()))
        return {
            "type": etype,
            "id": eid,
            "title": title,
            "emoji": emoji,
            "owner": owner,
            "editors": editors.get(key, [])[:5],
            "subscribers": subscribers,
            "completed": completed,
            "completion_rate": _rate(completed, subscribers) if completed is not None else None,
            "comments": comment_counts.get(key, 0),
            "likes": eng[key]["like"],
            "shares": eng[key]["share"],
            "hours": round(minutes_by_content.get(key, 0) / 60, 1),
            "man_days": round(
                minutes_by_content.get(key, 0) / 60 / settings.hours_per_man_day, 2
            ),
            # mode de formation: in_person | virtual | hybrid | elearning
            "format": fmt,
            # type de programme: internal | external (+ who provides it)
            "source": source,
            "provider": provider,
            "external": provider,  # kept for the existing UI label
            "attendance_rate": _rate(
                present_by_content.get(key, 0), marked_by_content.get(key, 0)
            ),
            "avg_stars": round(sum(stars) / len(stars), 1) if stars else None,
            "reviews_count": reviewers,
            # --- the fiche formation, on the reporting row itself ------------
            # HR kept opening each programme in another tab to answer "what is
            # this, how long, who is it for". Those are three columns, not three
            # page loads.
            "summary": summary,
            "level": level,
            "lessons": lessons,
            # What the programme is designed to take, as opposed to `hours`,
            # which is what people actually spent on it. The gap between the two
            # is the interesting number and it only exists if both are here.
            "planned_hours": round(planned_hours, 1),
            "objectives": (objectives or [])[:6],
            "prerequisites": prerequisites,
            "skills": (skills or [])[:8],
            "sessions_held": sessions_held,
            "feedback_rate": round(reviewers / subscribers * 100, 1) if subscribers else 0.0,
        }

    # Sessions actually held per formation — "3 sessions run" answers a
    # question the completion rate cannot.
    sessions_by_formation: dict[int, int] = defaultdict(int)
    for session in sessions_by_id.values():
        if session.formation_id:
            sessions_by_formation[session.formation_id] += 1

    def _lesson_count(content_obj) -> int:
        """Formations store a curriculum under "modules", courses under
        "sections". Counting only one of them silently reports every course as
        having no content, which is worse than not showing the column."""
        curriculum = content_obj.curriculum or {}
        try:
            groups = curriculum.get("modules") or curriculum.get("sections") or []
            return sum(len(g.get("lessons") or []) for g in groups)
        except Exception:  # malformed curriculum must not take down reporting
            return 0

    # Skills are a link table, not a column — one query beats one per programme.
    skills_by_content: dict[tuple[str, int], list[str]] = defaultdict(list)
    for link, skill_name in (
        db.query(SkillLink, Skill.name).join(Skill, Skill.id == SkillLink.skill_id).all()
    ):
        skills_by_content[(link.entity_type, link.entity_id)].append(skill_name)

    content = [
        content_row(
            "formation", f.id, f.title, f.emoji, f.trainer_name,
            len(f_followers.get(f.id, ())), f_completed.get(f.id, 0),
            fmt=f.format, source=f.source, provider=f.provider,
            level=f.level,
            lessons=_lesson_count(f),
            planned_hours=(
                sum(s.duration_min for s in sessions_by_id.values() if s.formation_id == f.id) / 60
                or (f.duration_hours or 0)
            ),
            objectives=list(f.objectives or []),
            prerequisites=f.prerequisites,
            skills=sorted(skills_by_content.get(("formation", f.id), [])),
            sessions_held=sessions_by_formation.get(f.id, 0),
            summary=getattr(f, "summary", "") or "",
        )
        for f in formations
    ] + [
        content_row(
            "course", c.id, c.title, c.emoji, c.author,
            len(c_followers.get(c.id, ())), None,
            # A course with an outside provider is an external program.
            fmt="elearning",
            source="external" if (c.provider or c.external_url) else "internal",
            provider=c.provider,
            level=c.level,
            lessons=_lesson_count(c),
            # For a course the published length is the plan; there are no
            # scheduled sessions to add up.
            planned_hours=c.external_hours or 0.0,
            skills=sorted(skills_by_content.get(("course", c.id), [])),
            summary=getattr(c, "summary", "") or "",
        )
        for c in courses
    ]
    if not scope.org_wide:
        # Keep only what this BU actually engaged with. Without this the rows
        # are BU-scoped but the totals below still cover the whole catalogue.
        content = [r for r in content if r["subscribers"] or r["hours"]]
    content.sort(key=lambda r: (r["subscribers"], r["hours"]), reverse=True)

    # ---- collaborator rows ---------------------------------------------------
    week_ago = dt.date.today() - dt.timedelta(days=7)
    collaborators = []
    for l in learners.values():
        active = (
            trainings_followed.get(l.id, 0) or minutes_by_learner.get(l.id, 0)
            or comments_by_learner.get(l.id, 0) or likes_given.get(l.id, 0)
        )
        if not active:
            continue
        hours = round(minutes_by_learner.get(l.id, 0) / 60, 1)
        external_hours = round(external_minutes_by_learner.get(l.id, 0) / 60, 1)
        external_courses = external_by_learner.get(l.id, 0)
        collaborators.append({
            "learner_id": l.id,
            "handle": l.handle,
            "name": l.name,
            "email": l.email,
            # The platform's own measure of somebody, beside the HR grade.
            "xp": l.xp or 0,
            "level": gamification.level_info(l.xp or 0)["level"],
            "team": teams.get(l.team_id, "") if l.team_id else "",
            "role": l.role,
            "bu": l.bu,
            "practice": l.practice,
            "location": l.location,
            "matricule": l.matricule,
            "job_level": l.job_level,
            "trainings_followed": trainings_followed.get(l.id, 0),
            "courses_followed": sum(1 for members in c_followers.values() if l.id in members),
            "lessons_done": lessons_done.get(l.id, 0),
            "hours": hours,
            "man_days": round(hours / settings.hours_per_man_day, 2),
            # How much of that time is scheduled session attendance (measured)
            # rather than estimated from completed content.
            "session_hours": round(session_minutes_by_learner.get(l.id, 0) / 60, 1),
            # Time spent inside AIDA only — `hours` above also carries the
            # provider's hours, so a reader comparing the two platforms needs
            # this one rather than a total that already mixes them.
            "app_hours": round(hours - external_hours, 1),
            # Learning done on Coursera & co.
            "external_hours": external_hours,
            # The share of that the provider actually measured.
            "external_measured_hours": round(
                external_measured_minutes_by_learner.get(l.id, 0) / 60, 1
            ),
            "external_courses": external_courses,
            "external_completed": external_done_by_learner.get(l.id, 0),
            "external_certificates": external_certs_by_learner.get(l.id, 0),
            "external_completion_rate": _rate(
                external_done_by_learner.get(l.id, 0), external_courses
            ),
            "external_last_activity": external_last_by_learner.get(l.id),
            # Present when this person's provider account is linked — the UI
            # uses it to open their Coursera profile.
            "coursera_email": external_email_by_learner.get(l.id, ""),
            # Learning the person logged themselves (articles, books, mentoring…).
            "declared_hours": round(declared_minutes_by_learner.get(l.id, 0) / 60, 1),
            "declared_records": declared_records_by_learner.get(l.id, 0),
            "sessions_marked": marked_by_learner.get(l.id, 0),
            "sessions_attended": present_by_learner.get(l.id, 0),
            "attendance_rate": _rate(
                present_by_learner.get(l.id, 0), marked_by_learner.get(l.id, 0)
            ),
            "comments": comments_by_learner.get(l.id, 0),
            "likes": likes_given.get(l.id, 0),
            "shares": shares_given.get(l.id, 0),
            "certificates": certs_by_learner.get(l.id, 0),
            "active_this_week": bool(l.last_active_on and l.last_active_on >= week_ago),
            "last_active_on": l.last_active_on,
        })
    collaborators.sort(key=lambda r: r["hours"], reverse=True)

    total_subscribers = sum(row["subscribers"] for row in content)
    total_reviewers = sum(row["reviews_count"] for row in content)
    total_completed = sum(row["completed"] or 0 for row in content)
    formation_subscribers = sum(
        row["subscribers"] for row in content if row["completed"] is not None
    )
    total_minutes = sum(minutes_by_learner.values())

    totals = {
        "learners": len(collaborators),
        "active_this_week": sum(1 for c in collaborators if c["active_this_week"]),
        "learning_hours": round(total_minutes / 60, 1),
        "man_days": round(total_minutes / 60 / settings.hours_per_man_day, 1),
        # Echoed so the UI can caption "base 7 h/jour" instead of leaving the
        # figure open to interpretation in an HR meeting (from M-02's F-11).
        "hours_per_man_day": settings.hours_per_man_day,
        "comments": sum(comment_counts.values()),
        "likes": sum(v["like"] for v in eng.values()),
        "shares": sum(v["share"] for v in eng.values()),
        "certificates": sum(certs_by_learner.values()),
        "trainings": len(formations),
        "courses": len(courses),
        "internal_programs": sum(1 for r in content if r["source"] == "internal"),
        "external_programs": sum(1 for r in content if r["source"] == "external"),
        # Filled in below only when the viewer is entitled to it.
        "completion_rate": _rate(total_completed, formation_subscribers) or 0.0,
        # Counted per learner, not per content: standalone open sessions have
        # no formation to attach to, and their attendance still counts.
        "attendance_rate": _rate(
            sum(present_by_learner.values()), sum(marked_by_learner.values())
        ),
        "sessions_attended": sum(present_by_learner.values()),
        "sessions_marked": sum(marked_by_learner.values()),
        "session_hours": round(sum(session_minutes_by_learner.values()) / 60, 1),
        # In-platform time on its own. `learning_hours` above is the blend, so
        # the App / Coursera / both switch needs each side stated separately.
        "app_hours": round(
            (total_minutes - sum(external_minutes_by_learner.values())) / 60, 1
        ),
        "external_hours": round(sum(external_minutes_by_learner.values()) / 60, 1),
        "external_courses": sum(external_by_learner.values()),
        "external_completed": sum(external_done_by_learner.values()),
        "external_certificates": sum(external_certs_by_learner.values()),
        "external_completion_rate": _rate(
            sum(external_done_by_learner.values()), sum(external_by_learner.values())
        ),
        "external_people": len(external_by_learner),
        "external_measured_hours": round(
            sum(external_measured_minutes_by_learner.values()) / 60, 1
        ),
        "declared_hours": round(sum(declared_minutes_by_learner.values()) / 60, 1),
        "declared_records": sum(declared_records_by_learner.values()),
        "declared_verified": declared_verified,
        # People learning on an external platform under an account we cannot
        # match. Non-zero means SSO is not covering everyone and the KPIs
        # understate reality.
        "external_unmatched": external_unmatched,
        "feedback_rate": round(total_reviewers / total_subscribers * 100, 1) if total_subscribers else 0.0,
    }

    return {
        "scope": {
            "label": scope.label,
            "bu": scope.bus[0] if scope.bus else "",
            "bus": scope.bus,
            "org_wide": scope.org_wide,
        },
        "hours_per_man_day": settings.hours_per_man_day,
        "totals": totals,
        "content": content,
        "collaborators": collaborators,
    }


# --------------------------------------------------------------------------- #
# exports                                                                     #
# --------------------------------------------------------------------------- #

FORMAT_LABELS = {
    "in_person": "Présentiel",
    "virtual": "Virtuel",
    "hybrid": "Hybride",
    "elearning": "E-learning",
}
SOURCE_LABELS = {"internal": "Interne", "external": "Externe"}
LEVEL_LABELS = {
    "beginner": "Débutant",
    "intermediate": "Intermédiaire",
    "advanced": "Avancé",
}


def _export_charts(report: dict, source: str) -> list[Chart]:
    """The pictures worth putting in front of a steering committee.

    Chosen for what they settle rather than for variety: where the effort went,
    how much of the total is measured rather than estimated, which programmes
    people actually finish, and — for L&D only — where the money went. Anything
    else is already a row in the tables behind them.
    """
    totals = report.get("totals", {})
    people = report.get("collaborators", [])
    content = report.get("content", [])
    hours_key = "hours" if source == "both" else "app_hours"

    hours_by_bu: dict[str, float] = defaultdict(float)
    for person in people:
        hours_by_bu[person.get("bu") or "Sans BU"] += person.get(hours_key) or 0

    charts = [
        Chart(
            "Heures de formation par BU",
            "bar",
            sorted(hours_by_bu.items(), key=lambda kv: kv[1], reverse=True),
            "heures",
        ),
        # The split is the chart that defends the Jour-Homme figure: it shows at
        # a glance how much of it is attendance and measured provider time
        # rather than an estimate from completed content. On the AIDA source the
        # two external slices are left out — they belong to the other platform.
        Chart(
            "Origine des heures",
            "pie",
            [
                ("Sessions (mesuré)", totals.get("session_hours") or 0),
                (
                    "Contenus terminés (estimé)",
                    (totals.get("app_hours") or 0)
                    - (totals.get("session_hours") or 0)
                    - (totals.get("declared_hours") or 0),
                ),
                ("Auto-déclaré", totals.get("declared_hours") or 0),
                *(
                    [
                        ("Coursera mesuré", totals.get("external_measured_hours") or 0),
                        (
                            "Coursera estimé",
                            (totals.get("external_hours") or 0)
                            - (totals.get("external_measured_hours") or 0),
                        ),
                    ]
                    if source == "both"
                    else []
                ),
            ],
        ),
        Chart(
            "Taux de complétion par programme",
            "bar",
            [
                (r.get("title", ""), r.get("completion_rate") or 0)
                for r in content
                if r.get("completion_rate") is not None
            ],
            "%",
        ),
    ]
    return charts


def _export_tables(report: dict, source: str) -> list[tuple[str, list[str], list[list]]]:
    """The two report tables, shared by the Excel and PDF renderers.


    `source` decides which hours the collaborator sheet reports, and whether
    the Coursera columns are there at all: a workbook that says "Heures" while
    silently blending two platforms is the thing the source switch exists to
    stop, on screen and in the file alike.
    """
    content_headers = [
        "Programme", "Type", "Niveau", "Mode", "Interne/Externe", "Prestataire",
        "Responsable", "Leçons", "Heures prévues", "Sessions tenues",
        "Inscrits", "Complété", "Taux complétion %", "Présence %",
        "Heures", "Jour-Homme",
        "Note moyenne", "Feedback rate %", "Compétences visées",
    ]
    content_rows = [
        [
            r["title"],
            "Formation" if r["type"] == "formation" else "Cours",
            LEVEL_LABELS.get(r.get("level", ""), r.get("level") or "—"),
            FORMAT_LABELS.get(r["format"], r["format"] or "—"),
            SOURCE_LABELS.get(r["source"], r["source"]),
            r["provider"] or "—",
            r["owner"] or "—",
            r.get("lessons", 0) or "—",
            r.get("planned_hours", 0) or "—",
            r.get("sessions_held", 0) or "—",
            r["subscribers"],
            r["completed"] if r["completed"] is not None else "—",
            r["completion_rate"] if r["completion_rate"] is not None else "—",
            r["attendance_rate"] if r["attendance_rate"] is not None else "—",
            r["hours"],
            r["man_days"],
            r["avg_stars"] if r["avg_stars"] is not None else "—",
            r["feedback_rate"],
            ", ".join(r.get("skills") or []) or "—",
        ]
        for r in report["content"]
    ]

    blended = source == "both"
    people_headers = [
        "Collaborateur", "Matricule", "BU", "Practice", "Location", "Job level", "Équipe",
        "Formations", "Cours", "Heures UpSkill",
        *(
            [
                "Compte Coursera", "Inscriptions Coursera", "Complétés Coursera",
                "Complétion Coursera %", "Heures Coursera", "Certificats Coursera",
                "Dernière activité Coursera", "Heures totales",
            ]
            if blended
            else []
        ),
        "Jour-Homme", "Sessions suivies", "Présence %", "Certificats", "Dernière activité",
    ]
    people_rows = [
        [
            r["name"] or r["handle"],
            r["matricule"] or "—",
            r["bu"] or "—",
            r["practice"] or "—",
            r["location"] or "—",
            r["job_level"] or "—",
            r["team"] or "—",
            r["trainings_followed"],
            r["courses_followed"],
            r["app_hours"],
            *(
                [
                    r["coursera_email"] or "—",
                    r["external_courses"] or "—",
                    r["external_completed"] or "—",
                    r["external_completion_rate"] if r["external_completion_rate"] is not None else "—",
                    r["external_hours"] or "—",
                    r["external_certificates"] or "—",
                    r["external_last_activity"].strftime("%d/%m/%Y") if r["external_last_activity"] else "—",
                    r["hours"],
                ]
                if blended
                else []
            ),
            # Jour-Homme follows the hours on display, so the two columns agree.
            r["man_days"] if blended else round(r["app_hours"] / settings.hours_per_man_day, 2),
            r["sessions_attended"],
            r["attendance_rate"] if r["attendance_rate"] is not None else "—",
            r["certificates"],
            r["last_active_on"].strftime("%d/%m/%Y") if r["last_active_on"] else "—",
        ]
        for r in report["collaborators"]
    ]
    return [
        ("Programmes", content_headers, content_rows),
        ("Collaborateurs", people_headers, people_rows),
    ]


def _coursera_tables(overview: dict, people: list[dict]) -> list[tuple[str, list[str], list[list]]]:
    """The provider's own material: breakdowns and one row per person.

    This is the whole Coursera population, not only the people with an account
    here — the same figures the Coursera panel shows on screen. Reporting only
    the matched share would understate it by an order of magnitude.
    """
    slice_headers = ["Libellé", "Personnes", "Inscriptions", "Jamais ouvert", "Heures", "Complétion %"]

    def slice_rows(rows: list[dict]) -> list[list]:
        return [
            [r["label"], r["people"], r["enrollments"], r["not_started"], r["hours"], r["completion_rate"]]
            for r in rows
        ]

    people_rows = [
        [
            p["name"], p["email"], p["business_unit"] or "—", p["job_title"] or "—",
            p["manager"] or "—", p["enrollments"], p["completed"], p["not_started"],
            p["completion_rate"], p["hours"], p["certificates"], p["last_activity"] or "—",
            "oui" if p["learner_id"] else "non",
        ]
        for p in sorted(people, key=lambda p: -p["hours"])
    ]
    return [
        ("Par programme", slice_headers, slice_rows(overview["by"]["program"])),
        ("Par BU", slice_headers, slice_rows(overview["by"]["business_unit"])),
        ("Par partenaire", slice_headers, slice_rows(overview["by"]["partner"])),
        (
            "Top contenus",
            ["Contenu", "Partenaire", "Inscriptions", "Complétés", "Heures", "Complétion %"],
            [
                [c["title"], c["partner"] or "—", c["enrollments"], c["completed"], c["hours"], c["completion_rate"]]
                for c in overview["top_courses"]
            ],
        ),
        (
            "Personnes",
            [
                "Nom", "Email", "BU", "Poste", "Manager", "Inscriptions", "Complétés",
                "Jamais ouvert", "Complétion %", "Heures", "Certificats",
                "Dernière activité", "Compte UpSkill",
            ],
            people_rows,
        ),
    ]


def _coursera_charts(overview: dict) -> list[Chart]:
    by = overview["by"]
    totals = overview["totals"]
    return [
        Chart("Heures Coursera par BU", "bar", [(r["label"], r["hours"]) for r in by["business_unit"]], "heures"),
        Chart(
            "Avancement des inscriptions",
            "pie",
            [
                ("Complétées", totals["completed"]),
                ("En cours", totals["in_progress"]),
                ("Jamais ouvertes", totals["not_started"]),
            ],
        ),
        Chart("Complétion par programme", "bar", [(r["label"], r["completion_rate"]) for r in by["program"]], "%"),
        Chart("Complétions par mois", "bar", [(r["label"], r["value"]) for r in overview["trend"]], "complétions"),
    ]


EXPORT_SOURCES = ("app", "coursera", "both")
SOURCE_TITLES = {
    "app": "Rapport formation — UpSkill",
    "coursera": "Rapport formation — Coursera",
    "both": "Rapport formation — UpSkill + Coursera",
}


@router.get("/hr/export")
def hr_export(
    fmt: str = "xlsx",
    source: str = "app",
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Download the HR report as a real Excel workbook or a PDF.

    Same data and same BU scoping as `/analytics/hr` — this only changes the
    container, so an HRBP's export can never contain another BU's people.

    `source` follows the switch on screen. On "coursera" the file is built from
    the provider's own population rather than from the people with an account
    here, exactly as the panel is: that view is not BU-scoped, because Coursera
    does not tell us which of our BUs most of those accounts belong to.
    """
    if fmt not in ("xlsx", "pdf"):
        raise HTTPException(status_code=400, detail="fmt must be 'xlsx' or 'pdf'.")
    if source not in EXPORT_SOURCES:
        raise HTTPException(status_code=400, detail=f"source must be one of {EXPORT_SOURCES}")

    stamp = dt.date.today().strftime("%Y-%m-%d")
    filename = f"aida-rapport-{source}-{stamp}.{fmt}"

    if source == "coursera":
        from app.api.routes.coursera_analytics import _by_person, _rows, overview as coursera_overview

        data = coursera_overview(learner_id=learner_id, x_admin_token=x_admin_token, db=db)
        if not data["totals"]:
            raise HTTPException(status_code=409, detail="No Coursera data synced yet.")
        k = data["totals"]
        tables = _coursera_tables(data, _by_person(_rows(db)))
        summary = [
            ["Contrat", data["contract"]],
            ["Personnes", k["people"]],
            ["Actives sur 90 jours", k["active_90d"]],
            ["Inscriptions", k["enrollments"]],
            ["Complétées", k["completed"]],
            ["En cours", k["in_progress"]],
            ["Jamais ouvertes", k["not_started"]],
            ["Taux de complétion %", k["completion_rate"]],
            ["Heures", k["hours"]],
            ["Jour-Homme", k["man_days"]],
            ["Certificats", k["certificates"]],
            # Stated, not hidden: these accounts have no profile here, so their
            # hours never reach the HR board.
            ["Comptes rattachés à UpSkill", f"{k['matched_people']} / {k['people']}"],
        ]
        if fmt == "xlsx":
            payload = build_xlsx(
                [("Synthèse", ["Indicateur", "Valeur"], summary), *tables],
                charts=_coursera_charts(data),
            )
        else:
            payload = build_pdf(
                SOURCE_TITLES[source],
                data["contract"] or "Coursera",
                [
                    ("Personnes", str(k["people"])),
                    ("Inscriptions", str(k["enrollments"])),
                    ("Complétion", f"{k['completion_rate']}%"),
                    ("Heures", str(k["hours"])),
                    ("Jour-Homme", str(k["man_days"])),
                    ("Rattachés", f"{k['matched_people']}/{k['people']}"),
                ],
                tables,
                charts=_coursera_charts(data),
            )
        media = (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            if fmt == "xlsx"
            else "application/pdf"
        )
        return Response(
            content=payload,
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    report = hr_analytics(learner_id=learner_id, x_admin_token=x_admin_token, db=db)
    tables = _export_tables(report, source)
    totals = report["totals"]
    charts = _export_charts(report, source)
    blended = source == "both"
    # The headline figure names its platform. "Heures de formation" over a
    # number that quietly includes Coursera is how a blended total ends up
    # quoted as an in-house one.
    hours_summary = (
        [
            ["Heures totales", totals["learning_hours"]],
            ["— dont UpSkill", totals["app_hours"]],
            ["— dont Coursera", totals["external_hours"]],
            ["Jour-Homme", totals["man_days"]],
            ["Inscriptions Coursera", totals["external_courses"]],
            ["Complétion Coursera %", totals["external_completion_rate"] if totals["external_completion_rate"] is not None else "—"],
            ["Collaborateurs rattachés à Coursera", f"{totals['external_people']} / {totals['learners']}"],
        ]
        if blended
        else [
            ["Heures UpSkill", totals["app_hours"]],
            ["— dont sessions suivies", totals["session_hours"]],
            ["— dont auto-déclaré", totals["declared_hours"]],
            ["Jour-Homme", round(totals["app_hours"] / settings.hours_per_man_day, 1)],
        ]
    )

    if fmt == "xlsx":
        payload = build_xlsx([
            (
                "Synthèse",
                ["Indicateur", "Valeur"],
                [
                    ["Périmètre", report["scope"]["label"]],
                    ["Source", SOURCE_TITLES[source]],
                    ["Collaborateurs actifs", totals["learners"]],
                    *hours_summary,
                    ["Programmes internes", totals["internal_programs"]],
                    ["Programmes externes", totals["external_programs"]],
                    ["Taux de complétion %", totals["completion_rate"]],
                    ["Taux de présence %", totals["attendance_rate"] if totals["attendance_rate"] is not None else "—"],
                    ["Feedback rate %", totals["feedback_rate"]],
                ],
            ),
            *tables,
        ], charts=charts)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        payload = build_pdf(
            SOURCE_TITLES[source],
            report["scope"]["label"],
            [
                ("Heures UpSkill", str(totals["app_hours"])),
                *([("Heures Coursera", str(totals["external_hours"]))] if blended else []),
                (
                    "Jour-Homme",
                    str(totals["man_days"] if blended else round(totals["app_hours"] / settings.hours_per_man_day, 1)),
                ),
                ("Collaborateurs", str(totals["learners"])),
                ("Complétion", f"{totals['completion_rate']}%"),
                ("Présence", f"{totals['attendance_rate']}%" if totals["attendance_rate"] is not None else "—"),
                ("Feedback", f"{totals['feedback_rate']}%"),
            ],
            tables,
            charts=charts,
        )
        media = "application/pdf"

    return Response(
        content=payload,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --------------------------------------------------------------------------- #
# HR lead: the HRBPs and their perimeters                                     #
# --------------------------------------------------------------------------- #


class PerimeterIn(BaseModel):
    hr_handle: str
    bus: list[str] = []
    learner_id: int | None = None


@router.get("/hr/perimeters")
def hr_perimeters(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Every HRBP, the BUs they cover, and how big that perimeter is.

    The HR lead's own view: not the numbers for one BU, but who is accountable
    for which BU and whether anything is uncovered. A BU with no HRBP is the
    thing worth spotting here, so it is reported explicitly rather than being
    absent from the list.
    """
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not (is_admin_token(x_admin_token) or (viewer and viewer.role in ("hr_lead", "admin"))):
        raise HTTPException(
            status_code=403, detail="Only the HR lead or an admin can see HRBP perimeters."
        )

    people = db.query(Learner).all()
    by_bu: dict[str, list[Learner]] = defaultdict(list)
    for p in people:
        if p.bu:
            by_bu[p.bu].append(p)

    # Only units that still exist. A perimeter row survives its BU being
    # retired, and listing those made closed units look like live ones nobody
    # was covering.
    live = {
        row[0]
        for row in db.query(BusinessUnit.name).filter(BusinessUnit.archived.is_(False)).all()
    }

    hrbps = [p for p in people if p.role == "hr"]
    covered: set[str] = set()
    rows = []
    for hrbp in sorted(hrbps, key=lambda p: (p.name or p.handle)):
        bus = [b for b in hr_perimeter(db, hrbp) if b in live]
        covered |= set(bus)
        headcount = sum(len(by_bu.get(b, [])) for b in bus)
        rows.append({
            "id": hrbp.id,
            "handle": hrbp.handle,
            "name": hrbp.name or hrbp.handle,
            "bus": bus,
            "headcount": headcount,
            # No perimeter means no access at all — worth flagging, because it
            # looks like a misconfiguration rather than a decision.
            "unassigned": not bus,
        })

    uncovered = sorted(b for b in by_bu if b not in covered)
    return {
        "hrbps": rows,
        "all_bus": sorted(by_bu),
        "uncovered_bus": uncovered,
        "totals": {
            "hrbps": len(rows),
            "bus": len(by_bu),
            "uncovered": len(uncovered),
            "people": sum(len(v) for v in by_bu.values()),
        },
    }


@router.post("/hr/perimeters")
def set_hr_perimeter(
    payload: PerimeterIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Set which BUs an HRBP covers. Replaces their whole perimeter."""
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not (is_admin_token(x_admin_token) or (viewer and viewer.role in ("hr_lead", "admin"))):
        raise HTTPException(
            status_code=403, detail="Only the HR lead or an admin can assign BUs."
        )

    hrbp = db.query(Learner).filter(Learner.handle.ilike(payload.hr_handle.strip())).first()
    if not hrbp:
        raise HTTPException(status_code=404, detail="No learner with that handle.")
    if hrbp.role not in ("hr", "hr_lead"):
        raise HTTPException(
            status_code=400,
            detail=f"{hrbp.handle} is '{hrbp.role}', not an HRBP. Grant the hr role first.",
        )

    db.query(HrBuAssignment).filter_by(hr_id=hrbp.id).delete()
    who = (viewer.name or viewer.handle) if viewer else "admin"
    for bu in dict.fromkeys(b.strip() for b in payload.bus if b.strip()):
        db.add(HrBuAssignment(hr_id=hrbp.id, bu=bu, assigned_by_name=who))
    db.commit()
    return {"handle": hrbp.handle, "bus": hr_perimeter(db, hrbp)}


# --------------------------------------------------------------------------- #
# org chart                                                                    #
# --------------------------------------------------------------------------- #


def _team_bu(members: list[Learner]) -> str:
    """Which BU a team belongs to.

    Teams carry no BU of their own — people do. So a team sits in whichever BU
    most of its members belong to, and a team whose members have no BU at all is
    reported under an explicit "unassigned" bucket rather than vanishing from
    the chart. Silently dropping a team here would hide exactly the teams whose
    HR data is incomplete, which are the ones worth seeing.
    """
    counts: dict[str, int] = defaultdict(int)
    for m in members:
        if m.bu:
            counts[m.bu] += 1
    if not counts:
        return ""
    return max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]


def _bu_node(
    name: str,
    label: str,
    teams_by_bu: dict[str, list[dict]],
    people_by_bu: dict[str, int],
    head: dict | None = None,
) -> dict:
    """One BU: its teams, and how many people it holds either way.

    `member_count` counts people organised into a team; `headcount` counts
    everyone in the BU. They differ exactly where somebody sits in a BU without
    a team, which is worth seeing rather than rounding away.
    """
    teams = sorted(teams_by_bu.get(name, []), key=lambda t: t["name"].lower())
    return {
        "name": label,
        # Who runs the BU, above every team manager inside it. None means the
        # unit has nobody accountable for it operationally — which also means
        # training requests raised there stall at their second stage.
        "head": head,
        "teams": teams,
        "team_count": len(teams),
        "member_count": sum(t["member_count"] for t in teams),
        "headcount": people_by_bu.get(name, 0),
    }


def _person(learner: Learner | None, role_label: str = "") -> dict | None:
    if learner is None:
        return None
    return {
        "id": learner.id,
        "handle": learner.handle,
        "name": learner.name or learner.handle,
        # The chart links every name to that person's learning record, and the
        # record is keyed by address. Empty means the name stays plain text.
        "email": learner.email or "",
        "role": learner.role,
        "role_label": role_label or learner.role,
        "bu": learner.bu or "",
        "job_level": learner.job_level or "",
    }


@router.get("/hr/org-chart")
def hr_org_chart(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """The reporting line, nested: HR lead, HRBPs, their BUs, teams, people.

    The org tab used to hang every team off the viewer directly, which drew a
    two-level list and called it a hierarchy — an HR lead could not see which
    HRBP was accountable for which BU without leaving the page. The real chain
    is HR lead over HRBPs, each HRBP over one or two BUs, each BU holding teams
    under their managers. That is what this returns.

    The shape is the same for an HRBP; they are simply the root, with only their
    own BUs beneath. Everyone below HR gets a 403, as elsewhere in this module.
    """
    viewer = db.get(Learner, learner_id) if learner_id else None
    admin = is_admin_token(x_admin_token)
    if not (admin or (viewer and viewer.role in ("hr", "hr_lead", "admin"))):
        raise HTTPException(status_code=403, detail="Only HR or admins can view analytics.")

    scope = reporting_scope(db, viewer, x_admin_token)
    people = db.query(Learner).all()
    by_id = {p.id: p for p in people}

    members_by_team: dict[int, list[Learner]] = defaultdict(list)
    for p in people:
        if p.team_id:
            members_by_team[p.team_id].append(p)

    # Teams, resolved to a BU and kept only where the viewer is entitled to see
    # them. An HRBP looking at this gets their own BUs and nothing else.
    teams_by_bu: dict[str, list[dict]] = defaultdict(list)
    for team in db.query(Team).all():
        members = sorted(
            members_by_team.get(team.id, []), key=lambda m: (m.name or m.handle).lower()
        )
        if not scope.org_wide:
            members = [m for m in members if scope.allows(m.id)]
            if not members:
                continue
        bu = _team_bu(members)
        teams_by_bu[bu].append({
            "id": team.id,
            "name": team.name,
            "manager": _person(by_id.get(team.manager_id), "manager"),
            "lead": _person(by_id.get(team.lead_id), "skill lead"),
            "members": [_person(m) for m in members],
            "member_count": len(members),
        })

    # Which BUs belong to which HRBP. A BU nobody covers is reported separately
    # rather than being folded into someone's perimeter.
    hrbps = [p for p in people if p.role == "hr"]
    if not scope.org_wide and viewer is not None:
        hrbps = [p for p in hrbps if p.id == viewer.id]

    # A BU with people but no team still belongs on the chart: "this unit exists
    # and has nobody organised into a team" is a finding, and leaving it out
    # would quietly shrink the organisation to only its tidy parts.
    people_by_bu: dict[str, int] = defaultdict(int)
    for p in people:
        if p.bu and (scope.org_wide or scope.allows(p.id)):
            people_by_bu[p.bu] += 1
    all_bus = sorted((set(teams_by_bu) | set(people_by_bu)) - {""})
    covered: set[str] = set()
    hrbp_nodes = []
    for hrbp in sorted(hrbps, key=lambda p: (p.name or p.handle).lower()):
        bus = hr_perimeter(db, hrbp)
        covered |= set(bus)
        bu_nodes = []
        for bu in bus:
            head = bu_head_for(db, bu)
            bu_nodes.append(
                _bu_node(bu, bu, teams_by_bu, people_by_bu, _person(head, "bu_head"))
            )
        node = _person(hrbp, "hrbp")
        node["bus"] = bu_nodes
        node["bu_count"] = len(bu_nodes)
        node["member_count"] = sum(b["member_count"] for b in bu_nodes)
        node["headcount"] = sum(b["headcount"] for b in bu_nodes)
        # An HRBP with no perimeter reads as a misconfiguration, not a decision.
        node["unassigned"] = not bus
        hrbp_nodes.append(node)

    # BUs with no HRBP, plus teams whose members have no BU at all. Both are
    # shown at the bottom of the chart, attached to nobody, because that is
    # precisely what is true of them.
    unattached = [
        _bu_node(bu, bu, teams_by_bu, people_by_bu, _person(bu_head_for(db, bu), "bu_head"))
        for bu in all_bus
        if bu not in covered
    ]
    if teams_by_bu.get(""):
        unattached.append(_bu_node("", "Sans BU", teams_by_bu, people_by_bu))

    # A key, not a sentence: the label is shown in whichever language the
    # viewer picked, so translating it here would hard-code French into an API.
    ROOT_LABELS = {"hr_lead": "hr_skills_manager", "hr": "hrbp", "admin": "admin"}
    root = _person(viewer, ROOT_LABELS.get(viewer.role, "") if viewer else "")
    if root is None and admin:
        root = {
            "id": None,
            "handle": "admin",
            "name": "Administration",
            "email": "",
            "role": "admin",
            "role_label": "admin",
            "bu": "",
            "job_level": "",
        }

    return {
        "root": root,
        "scope": {"label": scope.label, "org_wide": scope.org_wide},
        # True when the root really is above the HRBPs. An HRBP viewing their own
        # chart is the root of what they can see, but they lead nobody — the
        # frontend labels the two cases differently.
        "root_leads_hrbps": bool(admin or (viewer and viewer.role in ("hr_lead", "admin"))),
        "hrbps": hrbp_nodes,
        "unattached_bus": unattached,
        "totals": {
            "hrbps": len(hrbp_nodes),
            "bus": len({b["name"] for h in hrbp_nodes for b in h["bus"]})
            + len(unattached),
            "teams": sum(len(v) for v in teams_by_bu.values()),
            # BUs running without an operational head — the second approval
            # stage has nobody on it, so requests raised there stall.
            "headless_bus": sum(
                1
                for b in [bb for h in hrbp_nodes for bb in h["bus"]] + unattached
                if not b.get("head")
            ),
            "people": sum(len(t["members"]) for v in teams_by_bu.values() for t in v),
            "uncovered_bus": len(unattached),
        },
    }
