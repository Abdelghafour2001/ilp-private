"""Teams — a manager, and the collaborators who report to them.

Admins create teams and appoint leads; leads (or admins) manage members and
get a dashboard aggregating each member's XP, streaks, badges and formation
progress. Follows the platform's lightweight identity: the viewer passes
their learner_id, admins can alternatively use the X-Admin-Token header.
"""

import datetime as dt

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email_template import Button, render_email
from app.core.mailer import send_email
from app.core.notifier import notify
from app.db.session import get_db
from app.labs.gamification import level_info, streak_is_live
from app.models import (
    Achievement,
    Formation,
    FormationEnrollment,
    Learner,
    StepCompletion,
    Team,
)
from app.schemas.team import (
    AssignFormationRequest,
    MemberFormation,
    MemberRequest,
    TeamCreate,
    TeamDashboard,
    TeamMember,
    TeamOut,
    TeamTotals,
    TeamUpdate,
)

router = APIRouter(prefix="/teams", tags=["teams"])


# --------------------------------------------------------------------------- #
# Permission helpers                                                          #
# --------------------------------------------------------------------------- #


def _is_admin_token(token: str | None) -> bool:
    return bool(settings.admin_token) and token == settings.admin_token


def _is_admin(learner: Learner | None, token: str | None) -> bool:
    return _is_admin_token(token) or (learner is not None and learner.role == "admin")


def _is_people_admin(learner: Learner | None, token: str | None) -> bool:
    """HR responsibles get org-wide people powers (all teams), like admins."""
    return _is_admin(learner, token) or (
        learner is not None and learner.role in ("hr", "hr_lead")
    )


def _can_manage_members(team: Team, learner: Learner | None, token: str | None) -> bool:
    """The Skill Lead, the manager, HR, or an admin can run the team."""
    if _is_people_admin(learner, token):
        return True
    return learner is not None and learner.id in (team.lead_id, team.manager_id)


def _can_view(team: Team, learner: Learner | None, token: str | None) -> bool:
    return _can_manage_members(team, learner, token)


def _get_team(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


def _resolve_person(db: Session, handle: str, granted_role: str | None) -> Learner:
    person = db.query(Learner).filter(Learner.handle.ilike(handle.strip())).first()
    if not person:
        raise HTTPException(status_code=404, detail=f"No learner with handle '{handle}'")
    # Appointing someone grants the matching role (existing elevated roles kept).
    # `granted_role=None` appoints without changing anyone's role — used for the
    # team lead field, which no longer has a role behind it.
    if granted_role and person.role == "user":
        person.role = granted_role
    return person


def _team_out(db: Session, team: Team) -> TeamOut:
    lead = db.get(Learner, team.lead_id) if team.lead_id else None
    manager = db.get(Learner, team.manager_id) if team.manager_id else None
    count = db.query(Learner).filter(Learner.team_id == team.id).count()
    out = TeamOut.model_validate(team, from_attributes=True)
    out.lead_handle = lead.handle if lead else ""
    out.manager_handle = manager.handle if manager else ""
    out.member_count = count
    return out


# --------------------------------------------------------------------------- #
# CRUD                                                                        #
# --------------------------------------------------------------------------- #


@router.get("", response_model=list[TeamOut])
def list_teams(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Admins and HR see every team; leads and managers see their own."""
    viewer = db.get(Learner, learner_id) if learner_id else None
    q = db.query(Team)
    if not _is_people_admin(viewer, x_admin_token):
        if not viewer:
            return []
        q = q.filter((Team.lead_id == viewer.id) | (Team.manager_id == viewer.id))
    return [_team_out(db, t) for t in q.order_by(Team.name).all()]


@router.post("", response_model=TeamOut, status_code=201)
def create_team(
    payload: TeamCreate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _is_people_admin(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only HR or admins can create teams.")
    name = payload.name.strip()
    if db.query(Team).filter(Team.name.ilike(name)).first():
        raise HTTPException(status_code=409, detail=f"A team named '{name}' already exists.")
    team = Team(name=name, description=payload.description.strip())
    if payload.lead_handle:
        team.lead_id = _resolve_person(db, payload.lead_handle, None).id
    if payload.manager_handle:
        team.manager_id = _resolve_person(db, payload.manager_handle, "manager").id
    db.add(team)
    db.commit()
    db.refresh(team)
    return _team_out(db, team)


@router.put("/{team_id}", response_model=TeamOut)
def update_team(
    team_id: int,
    payload: TeamUpdate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _is_people_admin(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only HR or admins can edit teams.")
    if payload.name is not None:
        team.name = payload.name.strip()
    if payload.description is not None:
        team.description = payload.description.strip()
    if payload.lead_handle is not None:
        team.lead_id = _resolve_person(db, payload.lead_handle, None).id if payload.lead_handle else None
    if payload.manager_handle is not None:
        team.manager_id = _resolve_person(db, payload.manager_handle, "manager").id if payload.manager_handle else None
    db.commit()
    db.refresh(team)
    return _team_out(db, team)


@router.delete("/{team_id}", status_code=204)
def delete_team(
    team_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _is_people_admin(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only HR or admins can delete teams.")
    # Detach members first so they aren't left pointing at a dead team.
    db.query(Learner).filter(Learner.team_id == team.id).update({"team_id": None})
    db.delete(team)
    db.commit()


# --------------------------------------------------------------------------- #
# Members                                                                     #
# --------------------------------------------------------------------------- #


@router.post("/{team_id}/members")
def add_members(
    team_id: int,
    payload: MemberRequest,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_manage_members(team, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the team's Skill Lead or an admin can add members.")

    added, skipped = [], []
    for handle in payload.handles:
        handle = handle.strip()
        if not handle:
            continue
        member = db.query(Learner).filter(Learner.handle.ilike(handle)).first()
        if not member:
            skipped.append({"handle": handle, "reason": "no learner with this handle"})
        elif member.team_id == team.id:
            skipped.append({"handle": handle, "reason": "already in this team"})
        else:
            member.team_id = team.id
            added.append(member.handle)
            notify(
                db,
                [member.id],
                kind="team",
                title=f"You joined team {team.name}",
                body="Your Skill Lead now follows your learning progress there.",
                link="/team",
            )
    db.commit()
    return {"added": added, "skipped": skipped}


@router.delete("/{team_id}/members/{member_id}", status_code=204)
def remove_member(
    team_id: int,
    member_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_manage_members(team, viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only the team's Skill Lead or an admin can remove members.")
    member = db.get(Learner, member_id)
    if member and member.team_id == team.id:
        member.team_id = None
        db.commit()


# --------------------------------------------------------------------------- #
# Training assignment (affectation)                                           #
# --------------------------------------------------------------------------- #


@router.post("/{team_id}/assign-formation")
def assign_formation(
    team_id: int,
    payload: AssignFormationRequest,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """The lead or manager assigns a formation to the whole team or to specific
    members. Assignees get an invited enrollment (they accept in-app), an
    in-app notification, and an email."""
    team = _get_team(db, team_id)
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_manage_members(team, viewer, x_admin_token):
        raise HTTPException(
            status_code=403,
            detail="Only the team's Skill Lead, its manager or an admin can assign trainings.",
        )
    formation = db.get(Formation, payload.formation_id)
    if not formation or formation.status != "published":
        raise HTTPException(status_code=404, detail="No published training with that id.")

    members = db.query(Learner).filter(Learner.team_id == team.id)
    if payload.member_ids:
        members = members.filter(Learner.id.in_(payload.member_ids))
    assigner = (viewer.name or viewer.handle) if viewer else "admin"

    assigned, skipped = [], []
    for member in members.all():
        if member.id == formation.trainer_id:
            skipped.append({"handle": member.handle, "reason": "is the trainer"})
            continue
        exists = (
            db.query(FormationEnrollment)
            .filter_by(formation_id=formation.id, learner_id=member.id)
            .first()
        )
        if exists:
            skipped.append({"handle": member.handle, "reason": f"already {exists.status}"})
            continue
        db.add(FormationEnrollment(
            formation_id=formation.id,
            learner_id=member.id,
            status="invited",
            invited_by=assigner,
        ))
        assigned.append(member.handle)
        notify(
            db,
            [member.id],
            kind="assignment",
            title=f"Training assigned: {formation.title}",
            body=f"{assigner} assigned you this formation — open it to accept.",
            link=f"/formations/{formation.id}",
        )
        if member.email:
            url = f"{settings.frontend_origin}/formations/{formation.id}"
            html, body_text = render_email(
                heading=f"{formation.emoji} {formation.title}",
                preheader=f"{assigner} assigned you this training.",
                blocks=[
                    (
                        "p",
                        f"<b>{assigner}</b> assigned you this training for the team "
                        f"<b>{team.name}</b>.",
                    ),
                    ("note", "Open it and accept to start learning."),
                ],
                button=Button("Open the training", url),
            )
            send_email(
                to=member.email,
                subject=f"[UpSkill] Training assigned: “{formation.title}”",
                html=html,
                text=body_text,
            )
    db.commit()
    return {"assigned": assigned, "skipped": skipped}


# --------------------------------------------------------------------------- #
# Dashboard                                                                   #
# --------------------------------------------------------------------------- #


def _build_dashboard(
    db: Session, team: Team, can_manage: bool, only_ids: set[int] | None = None
) -> TeamDashboard:
    """Per-member XP, level, streak, badges, lab completions and formation
    progress, plus team-level totals.

    `only_ids` restricts the roster to a viewer's perimeter — an HRBP sees
    only their own BUs' people, even inside a team that spans several. None
    means no restriction. Empty means nobody, which is the fail-closed case.
    """
    q = db.query(Learner).filter(Learner.team_id == team.id)
    if only_ids is not None:
        q = q.filter(Learner.id.in_(only_ids or {0}))
    members = q.order_by(Learner.xp.desc()).all()
    member_ids = [m.id for m in members]

    badge_counts: dict[int, int] = {}
    step_counts: dict[int, int] = {}
    enrollments: dict[int, list[FormationEnrollment]] = {m: [] for m in member_ids}
    if member_ids:
        for lid, n in (
            db.query(Achievement.learner_id, func.count())
            .filter(Achievement.learner_id.in_(member_ids))
            .group_by(Achievement.learner_id)
        ):
            badge_counts[lid] = n
        for lid, n in (
            db.query(StepCompletion.learner_id, func.count())
            .filter(StepCompletion.learner_id.in_(member_ids))
            .group_by(StepCompletion.learner_id)
        ):
            step_counts[lid] = n
        for enr in db.query(FormationEnrollment).filter(
            FormationEnrollment.learner_id.in_(member_ids),
            FormationEnrollment.status.in_(("active", "completed")),
        ):
            enrollments[enr.learner_id].append(enr)

    formation_ids = {e.formation_id for rows in enrollments.values() for e in rows}
    formations = {
        f.id: f for f in db.query(Formation).filter(Formation.id.in_(formation_ids))
    } if formation_ids else {}

    # Local import: formations.py also imports helpers from this package level.
    from app.api.routes.formations import _progress

    week_ago = dt.date.today() - dt.timedelta(days=7)
    out_members: list[TeamMember] = []
    pcts: list[int] = []
    for m in members:
        my_formations = []
        for enr in enrollments.get(m.id, []):
            f = formations.get(enr.formation_id)
            if not f:
                continue
            pct = 100 if enr.status == "completed" else _progress(db, f, m.id).percent
            pcts.append(pct)
            my_formations.append(
                MemberFormation(id=f.id, title=f.title, emoji=f.emoji, status=enr.status, percent=pct)
            )
        lvl = level_info(m.xp)
        out_members.append(
            TeamMember(
                learner_id=m.id,
                handle=m.handle,
                name=m.name,
                email=m.email or "",
                role=m.role,
                xp=m.xp,
                level=lvl["level"],
                level_title=lvl["level_title"],
                current_streak=streak_is_live(m),
                badges=badge_counts.get(m.id, 0),
                lab_steps=step_counts.get(m.id, 0),
                last_active_on=m.last_active_on,
                formations=my_formations,
            )
        )

    totals = TeamTotals(
        members=len(members),
        total_xp=sum(m.xp for m in members),
        badges=sum(badge_counts.values()),
        active_this_week=sum(
            1 for m in members if m.last_active_on and m.last_active_on >= week_ago
        ),
        avg_formation_pct=round(sum(pcts) / len(pcts)) if pcts else 0,
    )
    return TeamDashboard(
        team=_team_out(db, team),
        totals=totals,
        members=out_members,
        can_manage=can_manage,
    )


@router.get("/names")
def team_names(db: Session = Depends(get_db)):
    """Public id+name list — powers filter dropdowns (leaderboard, feeds)."""
    return [
        {"id": t.id, "name": t.name}
        for t in db.query(Team).order_by(Team.name).all()
    ]


@router.get("/overview", response_model=list[TeamDashboard])
def org_overview(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """The HR view: every team with its manager, Skill Lead and full member
    dashboards — the data behind the organization graph.

    An HRBP (`hr`) sees only the teams of their own BU; L&D/admins see all."""
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _is_people_admin(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only HR or admins can view the organization overview.")

    from app.core.rbac import reporting_scope

    teams = db.query(Team).order_by(Team.name).all()
    scope = reporting_scope(db, viewer, x_admin_token)
    if not scope.org_wide:
        # A team belongs to a BU through its members; keep the teams that have
        # at least one member (or a lead/manager) inside the viewer's perimeter.
        bu_ids = set(scope.learner_ids or set())
        teams = [
            t
            for t in teams
            if bu_ids
            & (
                {m.id for m in db.query(Learner).filter(Learner.team_id == t.id).all()}
                | {i for i in (t.lead_id, t.manager_id) if i}
            )
        ]
    return [
        _build_dashboard(db, team, can_manage=True, only_ids=scope.learner_ids)
        for team in teams
    ]


@router.get("/{team_id}/dashboard", response_model=TeamDashboard)
def dashboard(
    team_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _can_view(team, viewer, x_admin_token):
        raise HTTPException(
            status_code=403,
            detail="Only the team's Skill Lead, its manager, HR or an admin can view this dashboard.",
        )
    return _build_dashboard(db, team, _can_manage_members(team, viewer, x_admin_token))
