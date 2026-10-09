"""Grades a learner's submission for a single lab step against its grader spec.

Runs server-side so answers are never exposed to the client. Code steps re-run
the submission on the server with the step's tests plus `hidden_test_code` —
the client's opinion of whether it passed is ignored.

The SQL and data-check graders (`sql_scalar`, `sql_result`,
`check_failing_count`) were removed along with the practice database they ran
against. A lab authored with one of them still loads, but grading it reports a
clear message instead of failing on a connection that no longer exists.
"""

from __future__ import annotations

from app.labs import code_runner
from app.labs.loader import Step

RETIRED_TYPES = {"sql_scalar", "sql_result", "check_failing_count"}


class GradeError(Exception):
    pass


def grade(step: Step, submission: dict, dataset_schema: str, dataset_table: str) -> dict:
    g = step.grader
    if not g.type:
        return {"passed": True, "message": "Marked complete.", "detail": {}}

    if g.type == "code":
        code = str(submission.get("code") or "")
        if not code.strip():
            raise GradeError("Submit your code first.")
        language = step.builder.language or "python"
        try:
            res = code_runner.run_code(
                language, code, step.builder.test_code, g.hidden_test_code
            )
        except RuntimeError as exc:
            raise GradeError(str(exc)) from exc
        return {
            "passed": res["passed"],
            "message": "All tests passed! 🎉" if res["passed"] else "Some tests failed — keep going.",
            "detail": {"output": res["output"]},
        }

    if g.type == "choice":
        answer = str(submission.get("answer", "")).strip()
        passed = answer.lower() == str(g.answer or "").strip().lower()
        return {
            "passed": passed,
            "message": "Correct!" if passed else "Not quite — try again.",
            "detail": {},
        }

    if g.type in RETIRED_TYPES:
        raise GradeError(
            "This exercise used the SQL practice database, which has been retired."
        )

    raise GradeError(f"Unknown grader type: {g.type}")
