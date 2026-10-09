from pydantic import BaseModel, ConfigDict, Field


class LearnerCreate(BaseModel):
    handle: str = Field(min_length=2, max_length=40)


class LearnerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    handle: str
    # The person's real name. Without it every screen fed by this schema — the
    # dashboard greeting, the profile header — falls back to the handle, and
    # the app greets a colleague as "abdelghafour.lahrache".
    name: str | None = None
    xp: int
    role: str = "user"  # user | trainer | manager | bu_head | hr | hr_lead | admin
    onboarded: bool = True  # False → the first-connection wizard should run
    locale: str = "fr"  # preferred UI + email language


class RecentActivity(BaseModel):
    lab_id: str
    lab_title: str
    step_title: str
    xp: int
    at: str


class LearnerOrgFields(BaseModel):
    """HR org axes — set by HR/admin via the admin API."""

    bu: str = ""
    practice: str = ""
    location: str = ""
    matricule: str = ""
    job_level: str = ""


class LearnerProfile(LearnerOut):
    bu: str = ""
    practice: str = ""
    location: str = ""
    matricule: str | None = None  # omitted (null) unless viewer is HR/admin
    job_level: str = ""
    completed_steps: list[str] = []  # "lab_id:step_id"
    badges: list[str] = []
    # Gamification
    level: int = 1
    level_title: str = "Novice"
    xp_into_level: int = 0
    xp_for_level: int = 0
    xp_to_next: int = 0
    level_pct: int = 0
    current_streak: int = 0
    longest_streak: int = 0
    recent: list[RecentActivity] = []


class LeaderboardEntry(BaseModel):
    handle: str
    name: str | None = None
    team_id: int | None = None
    team_name: str = ""
    xp: int  # all-time XP, or XP earned inside the requested period
    badges: int
    level: int = 1
    level_title: str = "Novice"
    current_streak: int = 0


class GradeRequest(BaseModel):
    learner_id: int | None = None
    submission: dict = {}
