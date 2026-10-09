"""Loads "stack" recipes — copy-paste-ready local setups for real data tools
(Kafka, dbt, Neo4j, Spark, ...) plus professional use cases.

Like labs, each recipe is one YAML file under `backend/stacks/`, so the team can
add tools and playbooks via PR. Recipes are reference content (prose + code
blocks), not graded.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class Block(BaseModel):
    type: str = "md"  # "md" | "code"
    body: str = ""
    language: str | None = None  # for code blocks
    filename: str | None = None  # optional label for code blocks


class UseCase(BaseModel):
    title: str
    body: str = ""


class Recipe(BaseModel):
    id: str
    name: str
    category: str = "Tools"
    emoji: str = "📦"
    difficulty: str = "intermediate"  # intermediate | advanced | expert
    summary: str = ""
    tags: list[str] = []
    prerequisites: list[str] = []
    blocks: list[Block] = []
    use_cases: list[UseCase] = Field(default_factory=list)


def _stacks_path() -> Path:
    return Path(__file__).resolve().parents[2] / "stacks"


@lru_cache(maxsize=1)
def _load_all() -> dict[str, Recipe]:
    out: dict[str, Recipe] = {}
    root = _stacks_path()
    if not root.exists():
        return out
    for f in sorted(root.glob("*.yaml")):
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
        recipe = Recipe.model_validate(data)
        if recipe.id in out:
            raise ValueError(f"Duplicate stack id {recipe.id!r} ({f.name})")
        out[recipe.id] = recipe
    return out


def reload_stacks() -> int:
    _load_all.cache_clear()
    return len(_load_all())


def list_stacks() -> list[Recipe]:
    return list(_load_all().values())


def get_stack(stack_id: str) -> Recipe | None:
    return _load_all().get(stack_id)


def stack_summary(recipe: Recipe) -> dict:
    return {
        "id": recipe.id,
        "name": recipe.name,
        "category": recipe.category,
        "emoji": recipe.emoji,
        "difficulty": recipe.difficulty,
        "summary": recipe.summary,
        "tags": recipe.tags,
        "use_case_count": len(recipe.use_cases),
    }


def public_stack(recipe: Recipe) -> dict:
    return recipe.model_dump()
