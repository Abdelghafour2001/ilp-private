from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AssetCreate(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    kind: str = "idea"
    summary: str = ""
    body_md: str = ""
    code: str | None = None
    link: str | None = None
    tags: list[str] = []
    learner_id: int | None = None
    author: str | None = None  # falls back to the learner's handle

class AssetReviewIn(BaseModel):
    learner_id: int
    decision: str = Field(pattern="^(approve|reject)$")
    note: str = ""


class AssetSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    kind: str
    summary: str
    tags: list[str]
    author: str
    created_at: datetime
    status: str
    learner_id: int | None


class AssetOut(AssetSummary):
    body_md: str
    code: str | None
    link: str | None
    learner_id: int | None
    reviewed_by: str | None
    review_note: str | None

class AssetUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=255)
    kind: str | None = None
    summary: str | None = None
    body_md: str | None = None
    code: str | None = None
    link: str | None = None
    tags: list[str] | None = None
    learner_id: int  # who's editing — required to check authorship