from collections import defaultdict

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.ai import judge_prompt, run_trainee_prompt
from app.core import external_progress, manager_alerts
from app.core.config import settings
from app.core.email_template import Button, render_email
from app.core.mailer import send_email
from app.core.notifier import notify
from app.core.tracking import track_editor
from app.api.routes.pathways import lock_reason
from app.db.session import get_db
from app.labs.gamification import touch_streak
from app.models import (
    AssessmentAttempt,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    FormationSession,
    Learner,
    Review,
    SessionRegistration,
    Skill,
    SkillLink,
)
from app.schemas.formation import (
    FORMATS,
    SOURCES,
    SkillTag,
    ChallengeRequest,
    CompleteRequest,
    EnrollRequest,
    FormationCard,
    FormationCreate,
    FormationSummary,
    FormationOut,
    InviteRequest,
    PlaygroundRequest,
    ProgressOut,
    RespondRequest,
    SessionCreate,
    SessionOut,
    find_lesson,
    iter_lessons,
    lesson_ids,
    normalize_curriculum,
)

router = APIRouter(prefix="/formations", tags=["formations"])


# --------------------------------------------------------------------------- #
# Permission helpers                                                          #
# --------------------------------------------------------------------------- #


def _is_admin_token(token: str | None) -> bool:
    return bool(settings.admin_token) and token == settings.admin_token


def _can_teach(learner: Learner | None) -> bool:
    """Who can create trainings: trainers, plus the people-side roles."""
    return learner is not None and learner.role in (
        "trainer", "manager", "bu_head", "hr", "hr_lead", "admin",
    )


def _can_manage(formation: Formation, learner: Learner | None, token: str | None) -> bool:
    if _is_admin_token(token) or (learner and learner.role in ("admin", "hr", "hr_lead")):
        return True
    return learner is not None and formation.trainer_id == learner.id


def _get_formation(db: Session, formation_id: int) -> Formation:
    formation = db.get(Formation, formation_id)
    if not formation:
        raise HTTPException(status_code=404, detail="Training not found")
    return formation


def _skills_of(db: Session, formation_id: int) -> list[SkillTag]:
    """The skills this training develops (compétences visées)."""
    rows = (
        db.query(Skill)
        .join(SkillLink, SkillLink.skill_id == Skill.id)
        .filter(SkillLink.entity_type == "formation", SkillLink.entity_id == formation_id)
        .order_by(Skill.category, Skill.name)
        .all()
    )
    return [SkillTag(id=s.id, name=s.name, category=s.category) for s in rows]


def _sync_skills(db: Session, formation_id: int, skill_ids: list[int]) -> None:
    """Make the training's skill links match `skill_ids` exactly."""
    wanted = {
        s.id for s in db.query(Skill).filter(Skill.id.in_(skill_ids))
    } if skill_ids else set()
    existing = {
        l.skill_id: l
        for l in db.query(SkillLink).filter_by(entity_type="formation", entity_id=formation_id)
    }
    for skill_id in wanted - existing.keys():
        db.add(SkillLink(skill_id=skill_id, entity_type="formation", entity_id=formation_id))
    for skill_id in existing.keys() - wanted:
        db.delete(existing[skill_id])


# --------------------------------------------------------------------------- #
# Card / progress computation                                                 #
# --------------------------------------------------------------------------- #


def _curriculum_stats(curriculum: dict) -> dict:
    lessons = list(iter_lessons(curriculum))
    return {
        "lesson_count": len(lessons),
        "module_count": len(curriculum.get("modules", [])),
        "total_xp": sum(l.get("xp", 10) for l in lessons),
        "duration_min": sum(l.get("duration_min", 5) for l in lessons),
    }


def gating_lesson(formation: Formation) -> dict | None:
    """The entry assessment that has to be taken first, if there is one."""
    for lesson in iter_lessons(formation.curriculum):
        if lesson.get("assessment") == "pre" and lesson.get("gating"):
            return lesson
    return None


def has_feedback(db: Session, entity_type: str, entity_id: int, learner_id: int) -> bool:
    return (
        db.query(Review)
        .filter_by(entity_type=entity_type, entity_id=entity_id, learner_id=learner_id)
        .first()
        is not None
    )


def _progress(db: Session, formation: Formation, learner_id: int) -> ProgressOut:
    ids = lesson_ids(formation.curriculum)
    rows = (
        db.query(FormationLessonCompletion)
        .filter_by(learner_id=learner_id, formation_id=formation.id)
        .all()
    )
    # Lessons done on the provider count as done here. They are computed, not
    # recorded: the trainee cannot tick off a Coursera course from this side,
    # and the XP for it was already granted when the enrolment synced.
    done = set(r.lesson_id for r in rows if r.lesson_id in set(ids))
    done |= external_progress.done_lesson_ids(db, formation.curriculum, learner_id) & set(ids)
    xp_by_lesson = {l["id"]: l.get("xp", 10) for l in iter_lessons(formation.curriculum)}

    # Feedback counts as a step rather than as a popup. Adding it to the
    # denominator is what makes the progress bar honest: the learner can see
    # one item left and what it is, instead of a bar stuck at 96% for no
    # visible reason.
    feedback_required = bool(formation.require_feedback)
    feedback_given = (
        has_feedback(db, "formation", formation.id, learner_id)
        if feedback_required
        else False
    )
    total = len(ids) + (1 if feedback_required else 0)
    completed_count = len(done) + (1 if feedback_given else 0)

    gate = gating_lesson(formation)
    gate_id = gate.get("id") if gate else None
    entry_score = next(
        (r.data.get("score") for r in rows if gate_id and r.lesson_id == gate_id),
        None,
    )

    return ProgressOut(
        total=total,
        completed=sorted(done),
        percent=round(100 * completed_count / total) if total else 0,
        xp_earned=sum(xp_by_lesson.get(i, 0) for i in done),
        feedback_required=feedback_required,
        feedback_given=feedback_given,
        gating_lesson_id=gate_id,
        gate_passed=gate_id is None or gate_id in done,
        entry_score=entry_score,
    )


def _card(db: Session, formation: Formation, viewer: Learner | None) -> FormationCard:
    stats = _curriculum_stats(formation.curriculum)
    enrolled_count = (
        db.query(FormationEnrollment)
        .filter(
            FormationEnrollment.formation_id == formation.id,
            FormationEnrollment.status.in_(("active", "completed")),
        )
        .count()
    )
    my_status = None
    my_progress = 0
    if viewer:
        if formation.trainer_id == viewer.id:
            my_status = "trainer"
        else:
            enr = (
                db.query(FormationEnrollment)
                .filter_by(formation_id=formation.id, learner_id=viewer.id)
                .first()
            )
            if enr:
                my_status = enr.status
                if enr.status in ("active", "completed"):
                    my_progress = _progress(db, formation, viewer.id).percent
    # Built from the schema rather than a hand-written field list. The list
    # silently dropped `mandatory` and `require_feedback` the day they were
    # added — every card claimed nothing was compulsory, and nothing failed.
    # Reading the fields off the model means a new column cannot go missing.
    return FormationCard(
        **FormationSummary.model_validate(formation).model_dump(),
        **stats,
        enrolled_count=enrolled_count,
        my_status=my_status,
        my_progress=my_progress,
    )


# --------------------------------------------------------------------------- #
# CRUD                                                                        #
# --------------------------------------------------------------------------- #


@router.get("", response_model=list[FormationCard])
def list_formations(learner_id: int | None = None, db: Session = Depends(get_db)):
    """All published formations, plus the viewer's drafts (as trainer) and
    anything they're invited to or enrolled in."""
    viewer = db.get(Learner, learner_id) if learner_id else None
    visible: dict[int, Formation] = {
        f.id: f for f in db.query(Formation).filter(Formation.status == "published")
    }
    if viewer:
        for f in db.query(Formation).filter(Formation.trainer_id == viewer.id):
            visible[f.id] = f
        enrolled_ids = [
            e.formation_id
            for e in db.query(FormationEnrollment).filter_by(learner_id=viewer.id)
        ]
        if enrolled_ids:
            for f in db.query(Formation).filter(Formation.id.in_(enrolled_ids)):
                visible[f.id] = f
    cards = [_card(db, f, viewer) for f in visible.values()]
    cards.sort(key=lambda c: c.id, reverse=True)
    return cards


@router.post("", response_model=FormationOut, status_code=201)
def create_formation(
    payload: FormationCreate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    learner = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not (_can_teach(learner) or _is_admin_token(x_admin_token)):
        raise HTTPException(
            status_code=403,
            detail="Only trainers, Skill Leads, managers, HR or admins can create trainings. Ask an admin for a role.",
        )
    formation = Formation(
        title=payload.title.strip(),
        summary=payload.summary.strip(),
        level=payload.level,
        emoji=payload.emoji or "🎓",
        tags=payload.tags,
        objectives=[o.strip() for o in payload.objectives if o.strip()],
        prerequisites=payload.prerequisites.strip(),
        format=payload.format if payload.format in FORMATS else "elearning",
        duration_hours=payload.duration_hours or None,
        source=payload.source if payload.source in SOURCES else "internal",
        provider=payload.provider.strip(),
        curriculum=normalize_curriculum(payload.curriculum),
        trainer_id=learner.id if learner else None,
        trainer_name=(learner.name or learner.handle) if learner else "admin",
        status=payload.status if payload.status in ("draft", "published") else "draft",
        open_enrollment=payload.open_enrollment,
        cost=max(0, payload.cost),
        mandatory=payload.mandatory,
        require_feedback=payload.require_feedback,
    )
    db.add(formation)
    db.flush()
    _sync_skills(db, formation.id, payload.skill_ids)
    db.commit()
    db.refresh(formation)
    out = FormationOut.model_validate(formation, from_attributes=True)
    out.curriculum = formation.curriculum
    out.skills = _skills_of(db, formation.id)
    return out


@router.get("/{formation_id}", response_model=FormationOut)
def get_formation(
    formation_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    formation = _get_formation(db, formation_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    out = FormationOut.model_validate(formation, from_attributes=True)
    out.curriculum = formation.curriculum
    out.skills = _skills_of(db, formation.id)
    if not _can_manage(formation, viewer, x_admin_token):
        out.join_code = ""
    return out


@router.put("/{formation_id}", response_model=FormationOut)
def update_formation(
    formation_id: int,
    payload: FormationCreate,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    formation = _get_formation(db, formation_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage(formation, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the trainer or an admin can edit this training.")
    formation.title = payload.title.strip()
    formation.summary = payload.summary.strip()
    formation.level = payload.level
    formation.emoji = payload.emoji or "🎓"
    formation.tags = payload.tags
    formation.objectives = [o.strip() for o in payload.objectives if o.strip()]
    formation.prerequisites = payload.prerequisites.strip()
    formation.duration_hours = payload.duration_hours or None
    if payload.format in FORMATS:
        formation.format = payload.format
    if payload.source in SOURCES:
        formation.source = payload.source
    formation.provider = payload.provider.strip()
    formation.curriculum = normalize_curriculum(payload.curriculum)
    if payload.status in ("draft", "published", "archived"):
        formation.status = payload.status
    formation.open_enrollment = payload.open_enrollment
    _sync_skills(db, formation.id, payload.skill_ids)
    formation.cost = max(0, payload.cost)
    formation.mandatory = payload.mandatory
    formation.require_feedback = payload.require_feedback
    track_editor(db, "formation", formation.id, viewer)
    db.commit()
    db.refresh(formation)
    out = FormationOut.model_validate(formation, from_attributes=True)
    out.curriculum = formation.curriculum
    out.skills = _skills_of(db, formation.id)
    return out


@router.delete("/{formation_id}", status_code=204)
def delete_formation(
    formation_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    formation = _get_formation(db, formation_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage(formation, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the trainer or an admin can delete this training.")
    db.delete(formation)
    db.commit()


# --------------------------------------------------------------------------- #
# Enrollment: invites, join code, open enrollment                             #
# --------------------------------------------------------------------------- #


@router.post("/{formation_id}/invite")
def invite_trainees(
    formation_id: int,
    payload: InviteRequest,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    formation = _get_formation(db, formation_id)
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_manage(formation, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the trainer or an admin can invite trainees.")

    invited, skipped = [], []
    for handle in payload.handles:
        handle = handle.strip()
        if not handle:
            continue
        learner = (
            db.query(Learner)
            .filter((Learner.handle.ilike(handle)) | (Learner.email.ilike(handle)))
            .first()
        )
        if not learner:
            skipped.append({"handle": handle, "reason": "No learner with that handle or email."})
            continue
        if learner.id == formation.trainer_id:
            skipped.append({"handle": handle, "reason": "That's the trainer."})
            continue
        exists = (
            db.query(FormationEnrollment)
            .filter_by(formation_id=formation.id, learner_id=learner.id)
            .first()
        )
        if exists:
            skipped.append({"handle": handle, "reason": f"Already {exists.status}."})
            continue
        db.add(
            FormationEnrollment(
                formation_id=formation.id,
                learner_id=learner.id,
                status="invited",
                invited_by=formation.trainer_name,
            )
        )
        invited.append(learner.handle)

        notify(
            db,
            [learner.id],
            kind="invite",
            title=f"You're invited: {formation.title}",
            body=f"{formation.trainer_name} invited you to this formation.",
            link=f"/formations/{formation.id}",
        )
        if learner.email:
            url = f"{settings.frontend_origin}/formations/{formation.id}"
            html, body_text = render_email(
                heading=f"{formation.emoji} {formation.title}",
                preheader=f"{formation.trainer_name} invited you to this training.",
                blocks=[
                    ("p", f"<b>{formation.trainer_name}</b> invited you to join this training."),
                    ("h", "Your join code"),
                    ("code", formation.join_code),
                    ("note", "Open the training to accept, or enter this code on its page."),
                ],
                button=Button("Open the training", url),
            )
            emailed = send_email(
                to=learner.email,
                subject=f"[UpSkill] You're invited to “{formation.title}”",
                html=html,
                text=body_text,
            )
            if not emailed:
                skipped.append({"handle": learner.handle, "reason": "invited, but email is disabled (no SMTP host)."})
    db.commit()
    return {"invited": invited, "skipped": skipped}


@router.post("/{formation_id}/respond")
def respond_to_invite(formation_id: int, payload: RespondRequest, db: Session = Depends(get_db)):
    formation = _get_formation(db, formation_id)
    enr = (
        db.query(FormationEnrollment)
        .filter_by(formation_id=formation_id, learner_id=payload.learner_id, status="invited")
        .first()
    )
    if not enr:
        raise HTTPException(status_code=404, detail="No pending invitation.")
    if payload.accept:
        enr.status = "active"
        learner = db.get(Learner, payload.learner_id)
        if formation.trainer_id and learner:
            notify(
                db,
                [formation.trainer_id],
                kind="enrollment",
                title=f"{learner.name or learner.handle} joined {formation.title}",
                link=f"/formations/{formation.id}/manage",
            )
    else:
        db.delete(enr)
    db.commit()
    return {"status": "active" if payload.accept else "declined"}


@router.post("/{formation_id}/enroll")
def enroll(formation_id: int, payload: EnrollRequest, db: Session = Depends(get_db)):
    formation = _get_formation(db, formation_id)
    learner = db.get(Learner, payload.learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    existing = (
        db.query(FormationEnrollment)
        .filter_by(formation_id=formation.id, learner_id=learner.id)
        .first()
    )
    if existing:
        if existing.status == "invited":
            existing.status = "active"
            db.commit()
            return {"status": "active"}
        return {"status": existing.status}

    code_ok = payload.join_code and payload.join_code == formation.join_code
    if not (code_ok or (formation.open_enrollment and formation.status == "published")):
        raise HTTPException(
            status_code=403,
            detail="This training is invite-only. Ask the trainer for an invitation or a join code.",
        )
    db.add(
        FormationEnrollment(formation_id=formation.id, learner_id=learner.id, status="active")
    )
    if formation.trainer_id:
        notify(
            db,
            [formation.trainer_id],
            kind="enrollment",
            title=f"{learner.name or learner.handle} joined {formation.title}",
            link=f"/formations/{formation.id}/manage",
        )
    db.commit()
    return {"status": "active"}


# --------------------------------------------------------------------------- #
# Progress                                                                    #
# --------------------------------------------------------------------------- #


def _require_active(db: Session, formation: Formation, learner_id: int) -> FormationEnrollment:
    enr = (
        db.query(FormationEnrollment)
        .filter_by(formation_id=formation.id, learner_id=learner_id)
        .first()
    )
    if not enr or enr.status == "invited":
        raise HTTPException(status_code=403, detail="Enroll in this training first.")
    return enr


@router.get("/{formation_id}/progress", response_model=ProgressOut)
def progress(formation_id: int, learner_id: int, db: Session = Depends(get_db)):
    formation = _get_formation(db, formation_id)
    return _progress(db, formation, learner_id)


@router.post("/{formation_id}/lessons/{lesson_id}/complete", response_model=ProgressOut)
def complete_lesson(
    formation_id: int, lesson_id: str, payload: CompleteRequest, db: Session = Depends(get_db)
):
    formation = _get_formation(db, formation_id)
    lesson = find_lesson(formation.curriculum, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    enr = _require_active(db, formation, payload.learner_id)

    # A milestone in one of the learner's pathways can hold this training back.
    reason = lock_reason(db, payload.learner_id, "formation", formation.id)
    if reason:
        raise HTTPException(status_code=423, detail=reason)

    # A gating entry assessment blocks everything else until it is submitted.
    # Enforced here rather than only in the UI: a padlock that a page reload
    # walks around is a decoration, and the entry score it protects is the
    # baseline the whole before/after measurement rests on.
    gate = gating_lesson(formation)
    if gate and gate["id"] != lesson["id"]:
        taken = (
            db.query(FormationLessonCompletion)
            .filter_by(
                learner_id=payload.learner_id,
                formation_id=formation.id,
                lesson_id=gate["id"],
            )
            .first()
        )
        if not taken:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Commencez par l'évaluation d'entrée « {gate.get('title', '')} » — "
                    "elle mesure votre niveau de départ."
                ),
            )

    _record_completion(db, formation, lesson, enr, payload.learner_id, payload.data)
    db.commit()
    return _progress(db, formation, payload.learner_id)


def _record_completion(
    db: Session,
    formation: Formation,
    lesson: dict,
    enrollment: FormationEnrollment,
    learner_id: int,
    data: dict,
) -> None:
    """Idempotently record a lesson completion, award XP, and roll the
    enrollment to `completed` when every lesson is done."""
    exists = (
        db.query(FormationLessonCompletion)
        .filter_by(learner_id=learner_id, formation_id=formation.id, lesson_id=lesson["id"])
        .first()
    )
    if exists:
        # An entry assessment measures the starting point, so the FIRST attempt
        # is the one that counts — overwriting it with a later, better score
        # would erase the very gap the post-test is meant to measure.
        if lesson.get("assessment") == "pre":
            return
        # Everywhere else, keep the best score visible to the trainer.
        if data and data.get("score", 0) > (exists.data or {}).get("score", 0):
            exists.data = data
        return
    db.add(
        FormationLessonCompletion(
            learner_id=learner_id,
            formation_id=formation.id,
            lesson_id=lesson["id"],
            data=data or {},
        )
    )
    learner = db.get(Learner, learner_id)
    if learner:
        learner.xp += lesson.get("xp", 10)
        touch_streak(learner)
    db.flush()
    ids = set(lesson_ids(formation.curriculum))
    done = {
        r.lesson_id
        for r in db.query(FormationLessonCompletion).filter_by(
            learner_id=learner_id, formation_id=formation.id
        )
    }
    done |= external_progress.done_lesson_ids(db, formation.curriculum, learner_id)
    if ids and ids.issubset(done):
        # Feedback is the last step, not an afterthought: a programme that
        # requires it is not finished until it is given, and the enrollment
        # says so rather than reporting a completion the report cannot back up.
        if formation.require_feedback and not has_feedback(
            db, "formation", formation.id, learner_id
        ):
            enrollment.status = "active"
        elif enrollment.status != "completed":
            enrollment.status = "completed"
            if learner:
                manager_alerts.tell_manager(
                    db, learner, kind="team_completion", key="team.done.formation",
                    title=formation.title,
                )


# --------------------------------------------------------------------------- #
# Interactive GenAI lessons                                                   #
# --------------------------------------------------------------------------- #


def _require_ai():
    if not settings.ai_enabled:
        raise HTTPException(
            status_code=400,
            detail="AI is not configured (set ANTHROPIC_API_KEY or run Ollama).",
        )


@router.post("/{formation_id}/lessons/{lesson_id}/playground")
def run_playground(
    formation_id: int, lesson_id: str, payload: PlaygroundRequest, db: Session = Depends(get_db)
):
    """Run the trainee's prompt live. Free experimentation — never graded."""
    _require_ai()
    formation = _get_formation(db, formation_id)
    lesson = find_lesson(formation.curriculum, lesson_id)
    if not lesson or lesson.get("type") != "prompt_playground":
        raise HTTPException(status_code=404, detail="Playground lesson not found")
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Write a prompt first.")
    try:
        output = run_trainee_prompt(
            prompt=payload.prompt,
            scenario=lesson.get("scenario"),
            input_data=lesson.get("challenge_input"),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"output": output}


@router.post("/{formation_id}/lessons/{lesson_id}/challenge")
def run_challenge(
    formation_id: int, lesson_id: str, payload: ChallengeRequest, db: Session = Depends(get_db)
):
    """Run the trainee's prompt, judge it against the rubric, and record a
    completion (with the score) when it passes."""
    _require_ai()
    formation = _get_formation(db, formation_id)
    lesson = find_lesson(formation.curriculum, lesson_id)
    if not lesson or lesson.get("type") != "prompt_challenge":
        raise HTTPException(status_code=404, detail="Challenge lesson not found")
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Write a prompt first.")
    enr = _require_active(db, formation, payload.learner_id)
    try:
        output = run_trainee_prompt(
            prompt=payload.prompt, input_data=lesson.get("challenge_input")
        )
        judgement = judge_prompt(
            task=lesson.get("task") or lesson.get("title", ""),
            rubric=lesson.get("rubric", []),
            prompt=payload.prompt,
            output=output,
            input_data=lesson.get("challenge_input"),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    passed = judgement["score"] >= lesson.get("min_score", 70)
    # Recorded whether or not it worked. A completion row only ever says
    # "eventually yes"; how many goes it took is the part L&D asks about.
    db.add(
        AssessmentAttempt(
            learner_id=payload.learner_id,
            entity_type="formation",
            entity_id=formation.id,
            lesson_id=lesson_id,
            kind="prompt_challenge",
            passed=passed,
            score=float(judgement["score"]),
            pass_mark=float(lesson.get("min_score", 70)),
        )
    )
    if passed:
        _record_completion(
            db,
            formation,
            lesson,
            enr,
            payload.learner_id,
            {"score": judgement["score"], "prompt": payload.prompt[:2000]},
        )
    db.commit()
    return {
        "output": output,
        "judgement": judgement,
        "passed": passed,
        "min_score": lesson.get("min_score", 70),
        "progress": _progress(db, formation, payload.learner_id),
    }


# --------------------------------------------------------------------------- #
# Trainer dashboard                                                           #
# --------------------------------------------------------------------------- #


@router.get("/{formation_id}/assessments")
def assessments(
    formation_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Before/after evaluation results for a training.

    Reports each trainee's entry score, exit score and the gain between them,
    which is what makes a pre/post assessment worth running: the number that
    matters is the delta, not either score on its own.
    """
    formation = _get_formation(db, formation_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage(formation, viewer, x_admin_token):
        raise HTTPException(
            status_code=403,
            detail="Only the trainer, HR or an admin can see assessment results.",
        )

    pre_ids = [
        l["id"] for l in iter_lessons(formation.curriculum) if l.get("assessment") == "pre"
    ]
    post_ids = [
        l["id"] for l in iter_lessons(formation.curriculum) if l.get("assessment") == "post"
    ]
    if not pre_ids and not post_ids:
        return {"configured": False, "pre_count": 0, "post_count": 0, "rows": [], "summary": {}}

    scores: dict[int, dict[str, list[float]]] = defaultdict(lambda: {"pre": [], "post": []})
    for row in db.query(FormationLessonCompletion).filter_by(formation_id=formation.id):
        slot = "pre" if row.lesson_id in pre_ids else "post" if row.lesson_id in post_ids else None
        if slot is None:
            continue
        score = (row.data or {}).get("score")
        if isinstance(score, (int, float)):
            scores[row.learner_id][slot].append(float(score))

    def _avg(values: list[float]) -> float | None:
        return round(sum(values) / len(values), 1) if values else None

    rows = []
    for lid, slots in scores.items():
        learner = db.get(Learner, lid)
        if not learner:
            continue
        pre, post = _avg(slots["pre"]), _avg(slots["post"])
        rows.append({
            "learner_id": lid,
            "handle": learner.handle,
            "name": learner.name,
            "pre_score": pre,
            "post_score": post,
            "gain": round(post - pre, 1) if pre is not None and post is not None else None,
        })
    rows.sort(key=lambda r: (r["gain"] is None, -(r["gain"] or 0)))

    complete = [r for r in rows if r["gain"] is not None]
    summary = {
        "measured": len(complete),
        "avg_pre": _avg([r["pre_score"] for r in complete]),
        "avg_post": _avg([r["post_score"] for r in complete]),
        "avg_gain": _avg([r["gain"] for r in complete]),
        "improved": sum(1 for r in complete if r["gain"] > 0),
    }
    return {
        "configured": True,
        "pre_count": len(pre_ids),
        "post_count": len(post_ids),
        "rows": rows,
        "summary": summary,
    }


@router.get("/{formation_id}/roster")
def roster(
    formation_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    formation = _get_formation(db, formation_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage(formation, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the trainer or an admin can see the roster.")

    ids = lesson_ids(formation.curriculum)
    enrollments = (
        db.query(FormationEnrollment, Learner)
        .join(Learner, Learner.id == FormationEnrollment.learner_id)
        .filter(FormationEnrollment.formation_id == formation.id)
        .order_by(FormationEnrollment.id)
        .all()
    )
    completions = db.query(FormationLessonCompletion).filter_by(formation_id=formation.id).all()
    by_learner: dict[int, dict[str, dict]] = {}
    for c in completions:
        by_learner.setdefault(c.learner_id, {})[c.lesson_id] = c.data or {}

    rows = []
    for enr, learner in enrollments:
        done = by_learner.get(learner.id, {})
        on_provider = external_progress.done_lesson_ids(db, formation.curriculum, learner.id)
        done_ids = [i for i in ids if i in done or i in on_provider]
        rows.append(
            {
                "learner_id": learner.id,
                "handle": learner.handle,
                "name": learner.name,
                "status": enr.status,
                "invited_by": enr.invited_by,
                "enrolled_at": enr.created_at,
                "completed": done_ids,
                "percent": round(100 * len(done_ids) / len(ids)) if ids else 0,
                "lesson_data": {i: done[i] for i in done_ids if done[i]},
            }
        )
    return {
        "formation_id": formation.id,
        "join_code": formation.join_code,
        "lesson_ids": ids,
        "trainees": rows,
    }


# --------------------------------------------------------------------------- #
# Live sessions (scheduled events)                                            #
# --------------------------------------------------------------------------- #


@router.get("/{formation_id}/sessions", response_model=list[SessionOut])
def list_sessions(formation_id: int, db: Session = Depends(get_db)):
    _get_formation(db, formation_id)
    return (
        db.query(FormationSession)
        .filter_by(formation_id=formation_id)
        .order_by(FormationSession.starts_at)
        .all()
    )


@router.post("/{formation_id}/sessions", response_model=SessionOut, status_code=201)
def create_session(
    formation_id: int,
    payload: SessionCreate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    formation = _get_formation(db, formation_id)
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_manage(formation, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the trainer or an admin can schedule sessions.")
    session = FormationSession(
        formation_id=formation.id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        starts_at=payload.starts_at,
        duration_min=max(5, payload.duration_min),
        location=payload.location.strip(),
        meeting_url=payload.meeting_url.strip(),
    )
    db.add(session)

    enrolled_ids = [
        e.learner_id
        for e in db.query(FormationEnrollment).filter(
            FormationEnrollment.formation_id == formation.id,
            FormationEnrollment.status.in_(("active", "completed", "invited")),
        )
    ]
    when = payload.starts_at.strftime("%a %d %b, %H:%M")
    notify(
        db,
        enrolled_ids,
        kind="session",
        title=f"New session: {session.title}",
        body=f"{formation.title} — {when}" + (f" · {session.location}" if session.location else ""),
        link="/schedule",
    )
    db.commit()
    db.refresh(session)
    return session


@router.delete("/{formation_id}/sessions/{session_id}", status_code=204)
def delete_session(
    formation_id: int,
    session_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    formation = _get_formation(db, formation_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage(formation, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the trainer or an admin can cancel sessions.")
    session = db.get(FormationSession, session_id)
    if session and session.formation_id == formation.id:
        db.delete(session)
        db.commit()


@router.get("/{formation_id}/certificate")
def certificate(
    formation_id: int,
    learner_id: int,
    locale: str = "fr",
    db: Session = Depends(get_db),
):
    """The certificate for finishing this training.

    Issued only on real completion, and completion here means what it means
    everywhere else in the platform — including the feedback step when the
    programme requires one. A certificate handed out at 94% would quietly
    redefine the number every report is built on.
    """
    from fastapi import Response

    from app.core.certificates import build_certificate

    formation = _get_formation(db, formation_id)
    learner = db.get(Learner, learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    progress = _progress(db, formation, learner_id)
    if progress.percent < 100:
        raise HTTPException(
            status_code=409,
            detail=(
                "Formation non terminée ("
                f"{progress.percent} %)."
                + (
                    " Il reste votre avis à donner."
                    if progress.feedback_required and not progress.feedback_given
                    else ""
                )
            ),
        )

    # Hours behind the certificate: attendance at this formation's sessions is
    # measured time; otherwise fall back to the scheduled length, and say which.
    marked = (
        db.query(SessionRegistration, FormationSession)
        .join(FormationSession, SessionRegistration.session_id == FormationSession.id)
        .filter(
            FormationSession.formation_id == formation.id,
            SessionRegistration.learner_id == learner_id,
            SessionRegistration.attended.is_(True),
        )
        .all()
    )
    attended_min = sum(session.duration_min or 0 for _, session in marked)
    scheduled_min = sum(
        s.duration_min or 0
        for s in db.query(FormationSession).filter_by(formation_id=formation.id)
    )
    hours = round((attended_min or scheduled_min) / 60, 1)

    exit_score = next(
        (
            (r.data or {}).get("score")
            for r in db.query(FormationLessonCompletion).filter_by(
                learner_id=learner_id, formation_id=formation.id
            )
            for lesson in [find_lesson(formation.curriculum, r.lesson_id)]
            if lesson and lesson.get("assessment") == "post"
        ),
        None,
    )

    pdf = build_certificate(
        learner_name=learner.name or learner.handle,
        programme=formation.title,
        record_id=formation.id,
        learner_id=learner.id,
        hours=hours,
        hours_measured=bool(attended_min),
        trainer=formation.trainer_name or "",
        score=exit_score,
        entry_score=progress.entry_score,
        locale=locale if locale in ("fr", "en") else "fr",
    )
    safe = "".join(ch for ch in formation.title if ch.isalnum() or ch in " -_")[:40].strip()
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="certificat-{safe or formation.id}.pdf"'
        },
    )
