from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class QuizQuestion(BaseModel):
    question: str
    options: list[str] = []
    answer_index: int = 0
    explanation: str = ""


class FormationLesson(BaseModel):
    """One lesson inside a module. Type-specific fields stay optional so the
    JSONB curriculum can mix theory and interactive practice freely."""

    id: str = ""  # filled in server-side if blank
    title: str
    # article | video | lab | quiz | prompt_playground | prompt_challenge | external_course
    type: str = "article"
    body_md: str = ""
    xp: int = 10
    duration_min: int = 5
    # video
    video_url: str | None = None
    # embedded hands-on lab
    lab_id: str | None = None
    # external_course — a catalogue entry done on the provider (Coursera & co).
    # The lesson is a link out; it counts as finished when the provider reports
    # the course finished, never by the trainee ticking it off here.
    course_id: int | None = None
    # quiz (multi-question, graded client-side like courses)
    questions: list[QuizQuestion] = []
    # Pre/post assessment: tag a quiz as the entry or exit evaluation and the
    # platform reports the gain between them per trainee and per training.
    # "" = an ordinary in-course quiz, which is the existing behaviour.
    assessment: str = ""  # "" | pre | post
    # A pre-assessment can be made compulsory: nothing else in the programme
    # opens until it is submitted. That is what makes the entry score a real
    # baseline — an optional entry quiz is taken by the people who would have
    # scored well anyway, which is worse than no baseline at all.
    gating: bool = False
    # Score (0-100) needed to count as passed. 0 = any submission counts, which
    # is the right default for a baseline: it measures, it does not filter.
    pass_score: int = 0
    # prompt_playground — free experimentation against the live LLM
    scenario: str | None = None  # optional hidden system prompt (e.g. "you are a support bot")
    starter_prompt: str | None = None
    goal_md: str | None = None  # what the trainee should try to achieve
    # prompt_challenge — graded by an LLM judge against a rubric
    task: str | None = None  # what the trainee's prompt must accomplish
    challenge_input: str | None = None  # input data their prompt runs against
    rubric: list[str] = []  # criteria the judge scores 0-100
    min_score: int = 70


class FormationModule(BaseModel):
    title: str
    lessons: list[FormationLesson] = []


class Curriculum(BaseModel):
    modules: list[FormationModule] = []


FORMATS = ("in_person", "virtual", "hybrid", "elearning")
SOURCES = ("internal", "external")  # type de programme


class SkillTag(BaseModel):
    id: int
    name: str
    category: str


class FormationCreate(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    summary: str = ""
    level: str = "beginner"
    emoji: str = "🎓"
    tags: list[str] = []
    objectives: list[str] = []
    prerequisites: str = ""
    format: str = "elearning"  # in_person | virtual | hybrid | elearning
    duration_hours: float | None = Field(default=None, ge=0, le=2000)
    source: str = "internal"  # internal | external
    provider: str = ""  # who delivers it, when external
    skill_ids: list[int] = []  # compétences visées (skill catalog links)
    curriculum: Curriculum = Field(default_factory=Curriculum)
    status: str = "draft"
    open_enrollment: bool = False
    cost: int = 0
    # Compliance and feedback, both set by whoever builds the programme.
    mandatory: bool = False
    require_feedback: bool = False
    learner_id: int | None = None  # the trainer creating it


class FormationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    summary: str
    level: str
    emoji: str
    tags: list[str]
    objectives: list[str]
    prerequisites: str = ""
    format: str = "elearning"
    duration_hours: float | None = None
    source: str = "internal"
    provider: str = ""
    trainer_name: str
    trainer_id: int | None
    status: str
    open_enrollment: bool
    cost: int
    # Compliance and feedback, both set by whoever builds the programme.
    mandatory: bool = False
    require_feedback: bool = False
    created_at: datetime


class FormationCard(FormationSummary):
    """Summary enriched with the viewer's relationship to the formation."""

    lesson_count: int = 0
    module_count: int = 0
    total_xp: int = 0
    duration_min: int = 0
    enrolled_count: int = 0
    # viewer-specific
    my_status: str | None = None  # invited | active | completed | trainer | None
    my_progress: int = 0  # percent


class FormationOut(FormationSummary):
    curriculum: dict
    join_code: str = ""  # blanked for non-trainers in the route
    skills: list[SkillTag] = []  # compétences visées


class ProgressOut(BaseModel):
    """`total` counts the feedback step when the programme requires one, so
    `completed`'s length and `total` deliberately differ by that step."""

    total: int
    completed: list[str]
    percent: int
    xp_earned: int
    feedback_required: bool = False
    feedback_given: bool = False
    # The entry assessment blocking the rest, and how the learner did on it.
    gating_lesson_id: str | None = None
    gate_passed: bool = True
    entry_score: int | None = None


class InviteRequest(BaseModel):
    handles: list[str] = []  # existing learner handles
    learner_id: int | None = None  # inviting trainer (for permission check)


class EnrollRequest(BaseModel):
    learner_id: int
    join_code: str | None = None


class RespondRequest(BaseModel):
    learner_id: int
    accept: bool


class CompleteRequest(BaseModel):
    learner_id: int
    data: dict = {}


class PlaygroundRequest(BaseModel):
    learner_id: int | None = None
    prompt: str


class ChallengeRequest(BaseModel):
    learner_id: int
    prompt: str


class SessionCreate(BaseModel):
    """A live event on a formation's schedule (kickoff, workshop, Q&A…), or a
    standalone open session anyone may register for."""

    title: str = Field(min_length=2, max_length=255)
    description: str = ""
    starts_at: datetime
    duration_min: int = 60
    location: str = ""
    meeting_url: str = ""
    learner_id: int | None = None  # the trainer scheduling it
    # --- open sessions ("for ALL") ---
    formation_id: int | None = None  # None = standalone session
    open_to_all: bool = False
    capacity: int = 0  # 0 = unlimited
    registration_deadline: datetime | None = None
    theme: str = ""
    trainer_handle: str = ""  # who runs it, if not the creator


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    formation_id: int | None
    title: str
    description: str
    starts_at: datetime
    duration_min: int
    location: str
    meeting_url: str
    open_to_all: bool = False
    capacity: int = 0
    registration_deadline: datetime | None = None
    theme: str = ""
    trainer_name: str = ""
    # registration state, filled per viewer by the route
    registered_count: int = 0
    waitlist_count: int = 0
    seats_left: int | None = None  # None = unlimited
    registration_open: bool = True
    my_registration: str | None = None  # registered | waitlisted | cancelled


class UpcomingEvent(SessionOut):
    """A session enriched with its formation's context for the schedule page.

    Standalone open sessions have no formation, so the formation fields carry
    neutral placeholders rather than being optional everywhere downstream."""

    formation_title: str = ""
    formation_emoji: str = "📅"
    formation_level: str = ""
    my_status: str | None = None  # viewer's enrollment status on the formation


class AttendanceMark(BaseModel):
    """One line of a register: did this learner show up?"""

    learner_id: int
    attended: bool | None = None


class AttendanceRequest(BaseModel):
    marks: list[AttendanceMark] = []
    learner_id: int | None = None  # the trainer taking the register


class RegistrationRequest(BaseModel):
    learner_id: int


class RosterEntry(BaseModel):
    learner_id: int
    handle: str
    name: str | None = None
    status: str
    attended: bool | None = None


def normalize_curriculum(curriculum: Curriculum) -> dict:
    """Assign stable lesson ids where missing and return a plain dict."""
    data = curriculum.model_dump()
    taken = {
        lesson["id"]
        for module in data["modules"]
        for lesson in module["lessons"]
        if lesson.get("id")
    }
    counter = 0
    for module in data["modules"]:
        for lesson in module["lessons"]:
            if not lesson.get("id"):
                counter += 1
                while f"fl{counter}" in taken:
                    counter += 1
                lesson["id"] = f"fl{counter}"
                taken.add(lesson["id"])
    return data


def iter_lessons(curriculum: dict):
    for module in curriculum.get("modules", []):
        for lesson in module.get("lessons", []):
            yield lesson


def lesson_ids(curriculum: dict) -> list[str]:
    return [lesson["id"] for lesson in iter_lessons(curriculum) if lesson.get("id")]


def find_lesson(curriculum: dict, lesson_id: str) -> dict | None:
    for lesson in iter_lessons(curriculum):
        if lesson.get("id") == lesson_id:
            return lesson
    return None
