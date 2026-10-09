"""AI features, provider-agnostic.

Works with either a Claude API key or a local Ollama model (see
`app.ai.providers`). Capabilities:

* `tutor_hint`     — a learning-lab mentor that nudges without spoiling.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

from pydantic import BaseModel, Field

from app.ai import providers


def tutor_hint(
    *,
    lab_title: str,
    step_title: str,
    step_body: str,
    dataset: str,
    submission: dict | None = None,
    last_result: dict | None = None,
    question: str | None = None,
) -> str:
    """An on-demand mentor for a lab step. Nudges, never hands over the answer."""
    system = (
        "You are a friendly, encouraging data-quality tutor inside an interactive "
        "learning lab. The learner is working through an exercise. Give a SHORT hint "
        "(2-3 sentences) that nudges them toward the answer — never give the full "
        "solution outright. If they asked a question, answer it at a conceptual level. "
        "Be warm and concrete. No preamble."
    )
    context = {
        "lab": lab_title,
        "step": step_title,
        "instructions": step_body,
        "dataset": dataset,
        "their_attempt": submission or "(nothing yet)",
        "last_grader_feedback": last_result or "(not attempted yet)",
        "their_question": question or "(none — just wants a hint)",
    }
    user = f"Context:\n{json.dumps(context, indent=2, default=str)}\n\nGive a hint."
    return providers.complete_text(system, user, max_tokens=800)


# --------------------------------------------------------------------------- #
# Conversational, streaming tutor                                             #
# --------------------------------------------------------------------------- #

_HINT_LADDER = {
    1: "Give only a gentle conceptual nudge — point at *what* to think about, not how.",
    2: "Give a more concrete direction: name the relevant concept, column, or check kind, "
    "but stop short of writing the answer.",
    3: "Walk through the approach step by step in plain language. You may show the *shape* of "
    "the solution (e.g. pseudo-SQL) but never the final literal answer they must submit.",
}


def stream_tutor_chat(
    *,
    lab_title: str,
    step_title: str,
    step_body: str,
    dataset: str,
    builder_mode: str,
    messages: list[dict],
    submission: dict | None = None,
    last_result: dict | None = None,
    hint_level: int = 1,
) -> Iterator[str]:
    """Stream a multi-turn tutor reply. The learner's full conversation is passed
    in `messages`; the lab context + an escalating hint policy go in the system
    prompt. Never reveals the literal answer."""
    ladder = _HINT_LADDER.get(max(1, min(3, hint_level)), _HINT_LADDER[1])
    context = {
        "lab": lab_title,
        "current_step": step_title,
        "step_instructions": step_body,
        "dataset": dataset,
        "exercise_type": builder_mode,
        "their_current_attempt": submission or "(nothing yet)",
        "last_grader_feedback": last_result or "(not attempted yet)",
    }
    system = (
        "You are UpSkill's AI tutor — a warm, sharp data & AI engineering mentor embedded in an "
        "interactive lab. You are having a conversation with a learner working through an exercise. "
        "Teach by guiding, not by solving. NEVER output the exact answer they need to submit "
        "(the SQL string, the check params, or the final value); if asked directly for the answer, "
        "redirect to the reasoning. Keep replies concise (2-5 sentences unless they ask to go deep), "
        "use concrete references to their dataset and attempt, and be encouraging.\n\n"
        f"Hint policy for this turn: {ladder}\n\n"
        f"Lab context:\n{json.dumps(context, indent=2, default=str)}"
    )
    # Guard against an empty conversation.
    convo = messages or [{"role": "user", "content": "Can you give me a hint to get started?"}]
    yield from providers.stream_chat(system, convo, max_tokens=1200)


# --------------------------------------------------------------------------- #
# Code / SQL review                                                           #
# --------------------------------------------------------------------------- #


class ReviewIssue(BaseModel):
    severity: str = Field(description="one of: critical, warning, nit")
    message: str = Field(description="What the issue is and why it matters.")


class CodeReview(BaseModel):
    verdict: str = Field(description="A one-line overall assessment.")
    strengths: list[str] = Field(default_factory=list, description="What the learner did well.")
    issues: list[ReviewIssue] = Field(default_factory=list)
    suggestion: str = Field(description="The single most valuable next improvement, conceptually.")


def review_submission(
    *, language: str, code: str, task: str, dataset: str | None = None
) -> dict:
    """A mentor-grade review of a code/SQL submission. Coaching, not the answer."""
    system = (
        "You are a senior engineer reviewing a learner's submission inside a teaching lab. "
        "Give an honest, encouraging code review: correctness, readability, edge cases, and "
        "idiomatic style for the language. Do NOT rewrite their whole solution for them — point "
        "out what to improve and why, so they learn. Be specific to their actual code."
    )
    payload = {
        "language": language,
        "task": task,
        "dataset": dataset or "(n/a)",
        "submission": code,
    }
    user = f"Review this submission:\n{json.dumps(payload, indent=2, default=str)}"
    return providers.complete_json(system, user, CodeReview, max_tokens=1500).model_dump()


# --------------------------------------------------------------------------- #
# AI-generated quizzes                                                        #
# --------------------------------------------------------------------------- #


class QuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(description="3-4 plausible options.")
    answer_index: int = Field(description="0-based index of the correct option.")
    explanation: str = Field(description="Why the answer is correct, 1-2 sentences.")


class Quiz(BaseModel):
    title: str
    questions: list[QuizQuestion]


def generate_quiz(*, topic: str, context: str = "", n: int = 5) -> dict:
    """Generate a multiple-choice quiz to check understanding of a topic."""
    system = (
        "You are an assessment designer for a data & AI engineering academy. Write a focused "
        "multiple-choice quiz that tests genuine understanding (not trivia). Each question has "
        "3-4 options with exactly one correct answer, plausible distractors, and a short "
        "explanation. Vary difficulty. Keep questions self-contained."
    )
    user = (
        f"Topic: {topic}\n"
        f"Reference material (optional):\n{context or '(none)'}\n\n"
        f"Write {n} questions."
    )
    return providers.complete_json(system, user, Quiz, max_tokens=2500).model_dump()


# --------------------------------------------------------------------------- #
# Formations: prompt playground + LLM-judged prompt challenges                #
# --------------------------------------------------------------------------- #


def run_trainee_prompt(
    *, prompt: str, scenario: str | None = None, input_data: str | None = None
) -> str:
    """Execute a trainee's prompt against the live LLM, exactly as written.

    `scenario` (optional) is a lesson-defined system prompt that frames the
    exercise (e.g. "You are a customer-support assistant"). `input_data` is
    appended the way real pipelines feed data into a prompt template.
    """
    system = scenario or (
        "You are a helpful assistant inside a prompt-engineering training. "
        "Respond to the trainee's prompt exactly as a production LLM would — "
        "do not coach, do not mention the training."
    )
    user = prompt if not input_data else f"{prompt}\n\n---\nINPUT:\n{input_data}"
    return providers.complete_text(system, user, max_tokens=1200)


class PromptJudgement(BaseModel):
    score: int = Field(description="0-100 overall score of the trainee's PROMPT quality per the rubric.")
    verdict: str = Field(description="One-line overall assessment, addressed to the trainee.")
    criteria: list[str] = Field(
        default_factory=list,
        description="Per-rubric-item verdicts, each '✓' or '✗' + criterion + short reason.",
    )
    strengths: list[str] = Field(default_factory=list, description="What the prompt does well.")
    improvements: list[str] = Field(
        default_factory=list, description="Concrete, prioritized ways to improve the prompt."
    )


def judge_prompt(
    *, task: str, rubric: list[str], prompt: str, output: str, input_data: str | None = None
) -> dict:
    """LLM-as-judge: score the trainee's *prompt* (not just the output) against
    the lesson's rubric, using the actual model output as evidence."""
    system = (
        "You are a strict but fair prompt-engineering examiner. Grade the trainee's PROMPT "
        "against the task and rubric. The model's actual output is evidence of how well the "
        "prompt works — a lucky output does not excuse a sloppy prompt, and a good prompt with "
        "a slightly imperfect output still scores well. Score 0-100: below 40 = misses the task, "
        "40-69 = partially there, 70-84 = solid, 85+ = excellent. Judge each rubric item "
        "explicitly. Address the trainee directly and be concrete."
    )
    payload = {
        "task": task,
        "rubric": rubric,
        "input_data_given_to_prompt": input_data or "(none)",
        "trainee_prompt": prompt,
        "model_output_produced": output,
    }
    user = f"Grade this submission:\n{json.dumps(payload, indent=2, default=str)}"
    result = providers.complete_json(system, user, PromptJudgement, max_tokens=1500)
    result.score = max(0, min(100, result.score))
    return result.model_dump()


# --------------------------------------------------------------------------- #
# Personalized recommendations / learning path                                #
# --------------------------------------------------------------------------- #


class Recommendation(BaseModel):
    lab_id: str
    title: str
    difficulty: str
    reason: str = Field(description="Why this is a good next step for THIS learner.")


class LearningPath(BaseModel):
    summary: str = Field(description="A 1-2 sentence read on where the learner is and what to focus on.")
    recommendations: list[Recommendation]


def recommend_next(*, completed: list[str], catalog: list[dict]) -> dict:
    """Recommend the next labs for a learner given what they've completed and the
    full catalog (each item: id, title, track, difficulty, summary, completed)."""
    system = (
        "You are a learning-path advisor. Given what a learner has completed and the catalog of "
        "available labs, recommend the 3-4 best NEXT labs. Build on their momentum, fill gaps, and "
        "respect a sensible difficulty progression across tracks. Only recommend labs from the "
        "catalog that they have NOT completed. Give a concrete, personal reason for each."
    )
    payload = {"completed_step_keys": completed, "catalog": catalog}
    user = f"Learner state and catalog:\n{json.dumps(payload, indent=2, default=str)}\n\nRecommend next labs."
    return providers.complete_json(system, user, LearningPath, max_tokens=2000).model_dump()
