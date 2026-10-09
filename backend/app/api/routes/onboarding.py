"""First-connection onboarding: capture role focus, skills to develop and a
weekly goal — then orient the newcomer to the pathways and trainings that
match, with an optional AI-written welcome when a model is configured.
"""

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.onboarding_config import ensure_seeded, goals_payload, roles_payload
from app.core.rbac import can_onboard
from app.db.session import get_db
from app.models import content_status
from app.models import (
    Formation,
    Learner,
    LearnerSkill,
    OnboardingGoal,
    OnboardingRole,
    OnboardingRoleSkill,
    Pathway,
    PathwayStep,
    Skill,
    SkillLink,
)

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class CompleteRequest(BaseModel):
    learner_id: int
    role_focus: str = "other"
    skill_ids: list[int] = []
    goal_min: int = 0


def _load_skills(db: Session) -> list[Skill]:
    skills = db.query(Skill).order_by(Skill.category, Skill.name).all()
    if skills:
        return skills
    # Fresh installs may skip seed_all — bootstrap the catalog so step 2 works.
    from app.seed_skills_pathways import seed

    seed(force=False)
    db.expire_all()
    return db.query(Skill).order_by(Skill.category, Skill.name).all()


@router.get("/options")
def options(db: Session = Depends(get_db)):
    # Skills first: seeding the roles needs the catalogue to exist so the
    # preselections can resolve to real ids.
    skills = _load_skills(db)
    ensure_seeded(db)
    return {
        "roles": roles_payload(db),
        "goals": goals_payload(db),
        "skills": [
            {"id": s.id, "name": s.name, "category": s.category, "description": s.description}
            for s in skills
        ],
    }


@router.post("/complete")
def complete(payload: CompleteRequest, db: Session = Depends(get_db)):
    me = db.get(Learner, payload.learner_id)
    if not me:
        raise HTTPException(status_code=404, detail="Learner not found")

    # 1. follow the chosen skills
    chosen = db.query(Skill).filter(Skill.id.in_(payload.skill_ids)).all() if payload.skill_ids else []
    for s in chosen:
        ls = db.query(LearnerSkill).filter_by(learner_id=me.id, skill_id=s.id).first()
        if not ls:
            db.add(LearnerSkill(learner_id=me.id, skill_id=s.id, level=0))
        else:
            ls.following = True

    # 2. weekly goal
    me.weekly_goal_min = max(0, min(payload.goal_min, 24 * 60))
    me.onboarded = True

    # 3. orientation: pathways & trainings whose content covers the chosen skills
    skill_ids = {s.id for s in chosen}
    linked = db.query(SkillLink).filter(SkillLink.skill_id.in_(skill_ids)).all() if skill_ids else []
    linked_keys = {(l.entity_type, l.entity_id) for l in linked}

    pathway_scores: dict[int, int] = {}
    for step in db.query(PathwayStep):
        if (step.entity_type, step.entity_id) in linked_keys:
            pathway_scores[step.pathway_id] = pathway_scores.get(step.pathway_id, 0) + 1
    pathways = []
    if pathway_scores:
        rows = (
            db.query(Pathway)
            .filter(Pathway.id.in_(pathway_scores), Pathway.status.in_(content_status.VISIBLE))
            .all()
        )
        rows.sort(key=lambda x: pathway_scores[x.id], reverse=True)
        pathways = [
            {"id": x.id, "title": x.title, "emoji": x.emoji, "summary": x.summary,
             "matched_steps": pathway_scores[x.id]}
            for x in rows[:3]
        ]

    trainings = []
    formation_ids = [eid for (etype, eid) in linked_keys if etype == "formation"]
    if formation_ids:
        trainings = [
            {"id": f.id, "title": f.title, "emoji": f.emoji, "summary": f.summary, "level": f.level}
            for f in db.query(Formation)
            .filter(Formation.id.in_(formation_ids), Formation.status == "published")
            .limit(4)
        ]

    # 4. optional AI welcome — degrade silently to a template if no model
    chosen_role = (
        db.query(OnboardingRole).filter(OnboardingRole.key == payload.role_focus).first()
    )
    role_label = (
        (chosen_role.label_en or chosen_role.label_fr) if chosen_role else "new"
    )
    skill_names = ", ".join(s.name for s in chosen) or "your interests"
    message = (
        f"Welcome aboard! Based on your {role_label} focus and the skills you picked "
        f"({skill_names}), here is where I'd start. Join a pathway below — it chains the "
        f"right trainings in the right order — and your weekly goal will keep you on pace."
    )
    try:
        from app.ai.providers import complete_text
        from app.core.config import settings
        if settings.ai_enabled:
            generated = complete_text(
                "You are UpSkill, a friendly corporate learning assistant. Reply in 2-3 warm "
                "sentences, no lists, no emojis at the start.",
                f"Welcome a new {role_label} colleague who wants to grow in: {skill_names}. "
                "Tell them the recommended pathway shown below is their best starting point.",
                max_tokens=160,
            )
            if generated and len(generated.strip()) > 40:
                message = generated.strip()
    except Exception:
        pass  # template message is fine

    db.commit()
    return {"message": message, "pathways": pathways, "trainings": trainings}


# --------------------------------------------------------------------------- #
# L&D console — editing what the wizard offers                                #
# --------------------------------------------------------------------------- #
# Same gate as creating a collaborator (`can_onboard`): L&D leads and platform
# admins. The wizard is the first thing a new hire sees, so who may rewrite it
# is the same question as who may onboard them.


class RoleIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    label_fr: str = Field(default="", max_length=120)
    label_en: str = Field(default="", max_length=120)
    emoji: str = Field(default="", max_length=8)
    skill_ids: list[int] = []
    active: bool = True


class GoalIn(BaseModel):
    minutes: int = Field(ge=5, le=24 * 60)
    label_fr: str = Field(default="", max_length=120)
    label_en: str = Field(default="", max_length=120)
    active: bool = True


class ConfigIn(BaseModel):
    roles: list[RoleIn]
    goals: list[GoalIn]


def _steward(db: Session, learner_id: int | None, token: str | None) -> Learner | None:
    actor = db.get(Learner, learner_id) if learner_id else None
    if not can_onboard(actor, token):
        raise HTTPException(
            status_code=403,
            detail="Only L&D or a platform admin can change the onboarding wizard.",
        )
    return actor


@router.get("/config")
def read_config(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """The full wizard, retired entries included — this is the editing view."""
    _steward(db, learner_id, x_admin_token)
    _load_skills(db)
    ensure_seeded(db)
    return {
        "roles": roles_payload(db, include_inactive=True),
        "goals": goals_payload(db, include_inactive=True),
        "skills": [
            {"id": s.id, "name": s.name, "category": s.category}
            for s in db.query(Skill).order_by(Skill.category, Skill.name).all()
        ],
    }


@router.put("/config")
def write_config(
    payload: ConfigIn,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Replace the wizard's content with what the console submitted.

    Rows are matched on their natural key (role `key`, goal `minutes`) and
    updated in place rather than dropped and recreated: a learner's stored
    `role_focus` is that key, and recreating rows would renumber ids under the
    preselection links for no benefit. Anything the console did not send is
    deactivated, never deleted — see the note on `OnboardingRole.active`.
    """
    _steward(db, learner_id, x_admin_token)

    keys = [r.key.strip().lower() for r in payload.roles]
    if len(set(keys)) != len(keys):
        raise HTTPException(status_code=400, detail="Two roles share the same key.")
    minutes = [g.minutes for g in payload.goals]
    if len(set(minutes)) != len(minutes):
        raise HTTPException(status_code=400, detail="Two goals share the same duration.")

    known_skills = {row.id for row in db.query(Skill.id)}
    existing_roles = {r.key: r for r in db.query(OnboardingRole).all()}
    for order, incoming in enumerate(payload.roles):
        key = incoming.key.strip().lower()
        role = existing_roles.pop(key, None)
        if not role:
            role = OnboardingRole(key=key)
            db.add(role)
        role.label_fr = incoming.label_fr.strip()
        role.label_en = incoming.label_en.strip()
        role.emoji = incoming.emoji.strip()
        role.sort_order = order
        role.active = incoming.active
        db.flush()

        wanted = {i for i in incoming.skill_ids if i in known_skills}
        current = {
            link.skill_id: link
            for link in db.query(OnboardingRoleSkill).filter(
                OnboardingRoleSkill.role_id == role.id
            )
        }
        for skill_id in wanted - set(current):
            db.add(OnboardingRoleSkill(role_id=role.id, skill_id=skill_id))
        for skill_id in set(current) - wanted:
            db.delete(current[skill_id])
    for orphan in existing_roles.values():
        orphan.active = False

    existing_goals = {g.minutes: g for g in db.query(OnboardingGoal).all()}
    for order, incoming_goal in enumerate(payload.goals):
        goal = existing_goals.pop(incoming_goal.minutes, None)
        if not goal:
            goal = OnboardingGoal(minutes=incoming_goal.minutes)
            db.add(goal)
        goal.label_fr = incoming_goal.label_fr.strip()
        goal.label_en = incoming_goal.label_en.strip()
        goal.sort_order = order
        goal.active = incoming_goal.active
    for orphan_goal in existing_goals.values():
        orphan_goal.active = False

    db.commit()
    return {
        "roles": roles_payload(db, include_inactive=True),
        "goals": goals_payload(db, include_inactive=True),
    }
