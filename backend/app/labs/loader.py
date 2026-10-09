"""Loads contributor-authored lab definitions from YAML files.

A lab is one `*.yaml` file under `backend/labs/`. Contributors add a lab by
dropping in a file and opening a PR — no code changes required. The schema is
validated on load so a malformed lab fails fast with a clear message.

Grader internals (expected answers/counts) live here on the server and are
stripped before a lab is sent to the browser — see `public_lab`.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from app.core.config import settings
from app.engine.checks import CHECK_KINDS


class Dataset(BaseModel):
    schema_name: str = Field(default="public", alias="schema")
    table: str

    model_config = {"populate_by_name": True}


class Builder(BaseModel):
    # How the learner answers this step in the UI.
    mode: str = "none"  # none | check | sql | choice | code
    table: str | None = None
    schema_name: str = Field(default="public", alias="schema")
    hint_column: str | None = None
    options: list[str] = []  # for choice mode

    # for code mode (in-browser execution): language + starter + hidden tests
    language: str | None = None  # python | javascript
    starter_code: str = ""
    test_code: str = ""

    model_config = {"populate_by_name": True}


class Grader(BaseModel):
    type: str | None = None  # check_failing_count | sql_scalar | sql_result | choice | code
    expect: float | int | str | None = None
    expect_min: float | int | None = None
    expect_max: float | int | None = None
    answer: str | None = None
    require_kind: str | None = None
    require_column: str | None = None

    # sql_scalar / sql_result: server-side reference query. The expected value
    # (or full result set) is computed at grade time, so no answers live in the
    # YAML and the dataset can be regenerated freely.
    reference_sql: str | None = None
    # sql_result: whether row order must match the reference.
    order_matters: bool = False
    # Static SQL constraints. Only meaningful to the retired SQL graders; kept so
    # labs authored with them still load.
    require_tables: list[str] = []
    require_constructs: list[str] = []
    allow_constant: bool = False
    # code: extra server-only tests, never shipped to the browser.
    hidden_test_code: str = ""


class Step(BaseModel):
    id: str
    type: str  # concept | exercise | challenge
    title: str
    body_md: str = ""
    xp: int = 0
    builder: Builder = Field(default_factory=Builder)
    grader: Grader = Field(default_factory=Grader)


class Lab(BaseModel):
    id: str
    title: str
    track: str = "Fundamentals"
    difficulty: str = "beginner"  # beginner | intermediate | advanced
    summary: str = ""
    tags: list[str] = []
    dataset: Dataset
    steps: list[Step]

    @property
    def total_xp(self) -> int:
        return sum(s.xp for s in self.steps)


def _labs_path() -> Path:
    p = Path(settings.labs_dir)
    if p.is_absolute():
        return p
    # Resolve relative to the backend root (this file: backend/app/labs/loader.py).
    return Path(__file__).resolve().parents[2] / settings.labs_dir


def _validate(lab: Lab) -> None:
    kinds = set(CHECK_KINDS)
    for step in lab.steps:
        rk = step.grader.require_kind
        if rk and rk not in kinds:
            raise ValueError(f"Lab {lab.id} step {step.id}: unknown check kind {rk!r}")


@lru_cache(maxsize=1)
def _load_all() -> dict[str, Lab]:
    labs: dict[str, Lab] = {}
    root = _labs_path()
    if not root.exists():
        return labs
    for f in sorted(root.glob("*.yaml")):
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
        lab = Lab.model_validate(data)
        _validate(lab)
        if lab.id in labs:
            raise ValueError(f"Duplicate lab id {lab.id!r} ({f.name})")
        labs[lab.id] = lab
    return labs


def reload_labs() -> int:
    _load_all.cache_clear()
    return len(_load_all())


def file_labs() -> dict[str, Lab]:
    return _load_all()


def list_labs() -> list[Lab]:
    return list(_load_all().values())


def get_lab(lab_id: str) -> Lab | None:
    return _load_all().get(lab_id)


def validate_definition(data: dict) -> Lab:
    """Validate a raw lab definition (from the admin editor) and return the Lab.

    Raises pydantic ValidationError / ValueError on bad input.
    """
    lab = Lab.model_validate(data)
    _validate(lab)
    return lab


def definition_of(lab: Lab) -> dict:
    """Serialize a Lab back to a plain definition dict (alias keys), suitable for
    storing in the DB or seeding the admin editor."""
    return lab.model_dump(by_alias=True)


def public_lab(lab: Lab) -> dict:
    """Lab view safe to send to the browser — grader answers removed."""
    return {
        "id": lab.id,
        "title": lab.title,
        "track": lab.track,
        "difficulty": lab.difficulty,
        "summary": lab.summary,
        "tags": lab.tags,
        "total_xp": lab.total_xp,
        "dataset": {"schema": lab.dataset.schema_name, "table": lab.dataset.table},
        "steps": [
            {
                "id": s.id,
                "type": s.type,
                "title": s.title,
                "body_md": s.body_md,
                "xp": s.xp,
                "builder": {
                    "mode": s.builder.mode,
                    "table": s.builder.table or lab.dataset.table,
                    "schema": s.builder.schema_name,
                    "hint_column": s.builder.hint_column,
                    "options": s.builder.options,
                    "language": s.builder.language,
                    "starter_code": s.builder.starter_code,
                    "test_code": s.builder.test_code,
                },
                "gradable": bool(s.grader.type),
            }
            for s in lab.steps
        ],
    }
