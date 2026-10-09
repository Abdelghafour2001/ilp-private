from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class CertificationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    provider: str = ""
    description: str = ""
    url: str = ""
    level: str = "beginner"
    tags: list[str] = []
    # Contractually required by a client — drives the priority renewal view.
    client_required: bool = False
    client_name: str = ""
    validity_months: int = 0  # 0 = never expires
    learner_id: int | None = None  # who's adding it


class CertificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    provider: str
    description: str
    url: str
    level: str
    tags: list[str]
    client_required: bool = False
    client_name: str = ""
    validity_months: int = 0
    added_by_name: str
    created_at: datetime
    earned_count: int = 0  # how many learners shared this one


class SuggestRequest(BaseModel):
    team_id: int | None = None  # suggest to a whole team…
    target_ids: list[int] = []  # …or recommend to specific people
    note: str = ""
    learner_id: int | None = None  # the lead/manager suggesting


class SuggestionOut(BaseModel):
    id: int
    certification: CertificationOut
    team_id: int | None = None
    team_name: str = ""
    target_id: int | None = None
    target_handle: str = ""
    suggested_by_name: str
    note: str
    created_at: datetime


class EarnedCreate(BaseModel):
    learner_id: int
    certification_id: int | None = None
    title: str = ""  # required unless certification_id resolves it
    issuer: str = ""
    obtained_on: date | None = None
    expires_on: date | None = None
    credential_url: str = ""
    file_name: str | None = None
    file_original_name: str | None = None


class EarnedOut(BaseModel):
    id: int
    learner_id: int
    handle: str
    name: str | None
    team_name: str
    certification_id: int | None
    title: str
    issuer: str
    obtained_on: date | None
    expires_on: date | None
    credential_url: str
    client_required: bool = False
    client_name: str = ""
    has_file: bool
    created_at: datetime
