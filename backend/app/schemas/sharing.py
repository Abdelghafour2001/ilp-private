from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class SharingCreate(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    abstract: str = ""
    body_md: str = ""
    presenter: str = ""
    session_date: date | None = None
    tags: list[str] = []
    file_name: str | None = None
    file_original_name: str | None = None
    recording_url: str | None = None
    learner_id: int | None = None
    author: str | None = None


class SharingUpdate(BaseModel):
    """An edit to an archived session, including replacing the deck."""

    title: str | None = Field(default=None, min_length=2, max_length=255)
    abstract: str | None = None
    body_md: str | None = None
    presenter: str | None = None
    session_date: date | None = None
    tags: list[str] | None = None
    file_name: str | None = None
    file_original_name: str | None = None
    recording_url: str | None = None
    learner_id: int | None = None


class SharingSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    abstract: str
    presenter: str
    session_date: date | None
    tags: list[str]
    author: str
    created_at: datetime
    has_deck: bool = False
    recording_url: str | None = None


class SharingOut(SharingSummary):
    body_md: str
    file_name: str | None
    file_original_name: str | None
    learner_id: int | None
