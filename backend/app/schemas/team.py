from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class TeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = ""
    lead_handle: str | None = None  # existing learner handle to appoint as Skill Lead
    manager_handle: str | None = None  # team manager — read-only dashboard access
    learner_id: int | None = None  # the admin performing the action


class TeamUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    lead_handle: str | None = None
    manager_handle: str | None = None
    learner_id: int | None = None


class MemberRequest(BaseModel):
    handles: list[str] = []  # existing learner handles to add
    learner_id: int | None = None  # the lead/manager/admin performing the action


class AssignFormationRequest(BaseModel):
    formation_id: int
    member_ids: list[int] = []  # empty = the whole team
    learner_id: int | None = None  # the lead/manager/admin assigning


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    lead_id: int | None
    lead_handle: str = ""
    manager_id: int | None = None
    manager_handle: str = ""
    member_count: int = 0
    created_at: datetime


class MemberFormation(BaseModel):
    """One formation a team member is enrolled in, with their progress."""

    id: int
    title: str
    emoji: str
    status: str  # invited | active | completed
    percent: int


class TeamMember(BaseModel):
    learner_id: int
    handle: str
    name: str | None
    # Their learning record is keyed by address, and the member list links to it.
    email: str
    role: str
    xp: int
    level: int
    level_title: str
    current_streak: int
    badges: int
    lab_steps: int
    last_active_on: date | None
    formations: list[MemberFormation] = []


class TeamTotals(BaseModel):
    members: int
    total_xp: int
    badges: int
    active_this_week: int
    avg_formation_pct: int  # mean progress across members' active enrollments


class TeamDashboard(BaseModel):
    team: TeamOut
    totals: TeamTotals
    members: list[TeamMember]
    can_manage: bool = False  # false for read-only viewers (the team's manager)
