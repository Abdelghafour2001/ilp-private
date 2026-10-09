from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ChallengeCreate(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    summary: str = ""
    brief_md: str = ""
    theme: str = "General"
    prize: str | None = None
    deadline: date | None = None
    tags: list[str] = []
    learner_id: int | None = None
    author: str | None = None


class ChallengeUpdate(BaseModel):
    """An edit to a challenge. Every field optional: the form sends what it has,
    and a missing one means "leave it alone" rather than "clear it"."""

    title: str | None = Field(default=None, min_length=2, max_length=255)
    summary: str | None = None
    brief_md: str | None = None
    theme: str | None = None
    prize: str | None = None
    deadline: date | None = None
    tags: list[str] | None = None
    learner_id: int | None = None


class ChallengeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    summary: str
    theme: str
    prize: str | None
    deadline: date | None
    status: str
    tags: list[str]
    author: str
    created_at: datetime


class SubmissionCreate(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    summary: str = ""
    body_md: str = ""
    link: str | None = None
    learner_id: int | None = None
    author: str | None = None


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    challenge_id: int
    title: str
    summary: str
    body_md: str
    link: str | None
    author: str
    learner_id: int | None
    created_at: datetime
    votes: int = 0


class ChallengeDetail(ChallengeSummary):
    brief_md: str
    learner_id: int | None
    submissions: list[SubmissionOut] = []
