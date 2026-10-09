"""Grader tests."""

import pytest

from app.labs.grader import GradeError, grade
from app.labs.loader import Builder, Grader, Step


def make_step(**grader_kwargs) -> Step:
    return Step(
        id="s",
        type="challenge",
        title="t",
        builder=Builder(mode="sql"),
        grader=Grader(**grader_kwargs),
    )


@pytest.mark.parametrize("retired", ["sql_scalar", "sql_result", "check_failing_count"])
def test_retired_sql_graders_explain_instead_of_crashing(retired):
    # The practice database is gone. A lab still authored with one of these
    # types must say so, not surface a connection error.
    with pytest.raises(GradeError, match="retired"):
        grade(make_step(type=retired, expect=1), {"sql": "SELECT 1"}, "public", "t")


def test_choice_step():
    step = make_step(type="choice", answer="RAG")
    assert grade(step, {"answer": " rag "}, "public", "t")["passed"]
    assert not grade(step, {"answer": "SQL"}, "public", "t")["passed"]


def test_code_step_ignores_client_passed_flag():
    step = Step(
        id="s",
        type="exercise",
        title="t",
        builder=Builder(mode="code", language="python"),
        grader=Grader(type="code"),
    )
    # The old exploit: POST {"passed": true} with no code.
    with pytest.raises(GradeError):
        grade(step, {"passed": True}, "public", "customers")


def test_code_step_runs_server_side():
    step = Step(
        id="s",
        type="exercise",
        title="t",
        builder=Builder(
            mode="code",
            language="python",
            test_code="assert add(2, 3) == 5",
        ),
        grader=Grader(type="code", hidden_test_code="assert add(-1, 1) == 0"),
    )
    ok = grade(step, {"code": "def add(a, b):\n    return a + b"}, "public", "t")
    assert ok["passed"]

    # Passes the visible test but not the hidden one.
    cheat = "def add(a, b):\n    return 5"
    res = grade(step, {"code": cheat}, "public", "t")
    assert not res["passed"]
