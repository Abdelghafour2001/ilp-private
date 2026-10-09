from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Lesson(BaseModel):
    id: str = ""  # filled in server-side if blank
    title: str
    type: str = "article"  # article | video | lab | quiz
    body_md: str = ""
    video_url: str | None = None
    lab_id: str | None = None
    # quiz
    question: str | None = None
    options: list[str] = []
    answer: str | None = None


class Section(BaseModel):
    title: str
    lessons: list[Lesson] = []


class Curriculum(BaseModel):
    sections: list[Section] = []


class CourseCreate(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    summary: str = ""
    level: str = "beginner"
    emoji: str = "📚"
    tags: list[str] = []
    curriculum: Curriculum = Field(default_factory=Curriculum)
    # Ignored on create: a course always starts as a draft.
    status: str = "draft"
    # external catalog entry (Coursera, Udemy…) — link instead of content
    external_url: str = ""
    provider: str = ""
    cover_url: str = ""
    cost: int = 0
    learner_id: int | None = None
    author: str | None = None


class CourseSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    summary: str
    level: str
    emoji: str
    tags: list[str]
    author: str
    external_url: str = ""
    provider: str = ""
    # The provider's own subject classification, for filtering the catalogue.
    domain: str = ""
    subdomain: str = ""
    # Resolved server-side: explicit cover, else a derived video thumbnail,
    # else "" (the UI then renders a provider placeholder).
    cover_url: str = ""
    external_hours: float = 0.0
    cost: int
    created_at: datetime


class CourseOut(CourseSummary):
    curriculum: dict
    learner_id: int | None
    status: str
    reviewed_by: str | None = None
    review_note: str | None = None


def normalize_curriculum(curriculum: Curriculum) -> dict:
    """Assign stable lesson ids where missing and return a plain dict."""
    data = curriculum.model_dump()
    counter = 0
    for section in data["sections"]:
        for lesson in section["lessons"]:
            if not lesson.get("id"):
                counter += 1
                lesson["id"] = f"l{counter}"
    return data


def lesson_ids(curriculum: dict) -> list[str]:
    return [
        lesson["id"]
        for section in curriculum.get("sections", [])
        for lesson in section.get("lessons", [])
        if lesson.get("id")
    ]
