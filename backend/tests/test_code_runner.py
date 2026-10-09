from app.labs.code_runner import run_code


def test_passing_python():
    res = run_code("python", "def f():\n    return 1", "assert f() == 1")
    assert res["passed"]


def test_failing_python():
    res = run_code("python", "def f():\n    return 2", "assert f() == 1")
    assert not res["passed"]
    assert "AssertionError" in res["output"]


def test_hidden_tests_run():
    res = run_code("python", "x = 1", "assert x == 1", hidden_test_code="assert x == 2")
    assert not res["passed"]


def test_timeout():
    res = run_code("python", "while True:\n    pass", "")
    assert not res["passed"]
    assert "Timed out" in res["output"]
