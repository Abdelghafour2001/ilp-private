"""Server-side execution of code-lab submissions.

The browser still runs code locally (Pyodide / JS) for the fast feedback loop,
but passing is decided *here*: the submission is re-run in a throwaway
subprocess together with the step's tests — including `hidden_test_code`,
which is never sent to the client. This closes the old hole where the client
could simply report `{"passed": true}`.

Python runs with `-I` (isolated mode) under a wall-clock timeout and, where
the platform supports it, CPU/memory rlimits. This is an internal upskilling
tool, not a public judge — the goal is honest grading, not a jail.
"""

from __future__ import annotations

import shutil
import subprocess
import sys

TIMEOUT_SECONDS = 10
MAX_OUTPUT_CHARS = 4000


def _limit_resources() -> None:  # pragma: no cover — Linux-only
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT_SECONDS, TIMEOUT_SECONDS))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))


def run_code(language: str, code: str, test_code: str, hidden_test_code: str = "") -> dict:
    """Run submission + tests; passed == the process exited cleanly."""
    program = "\n\n".join(part for part in (code, test_code, hidden_test_code) if part)

    if language == "python":
        cmd = [sys.executable, "-I", "-c", program]
    elif language == "javascript":
        node = shutil.which("node")
        if not node:
            raise RuntimeError(
                "JavaScript grading needs Node.js on the server — install it in the backend image."
            )
        cmd = [node, "--no-warnings", "-e", program]
    else:
        raise RuntimeError(f"Unsupported code language: {language!r}")

    kwargs: dict = {}
    if sys.platform != "win32":
        kwargs["preexec_fn"] = _limit_resources

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            **kwargs,
        )
    except subprocess.TimeoutExpired:
        return {
            "passed": False,
            "output": f"Timed out after {TIMEOUT_SECONDS}s — infinite loop?",
        }

    output = ((proc.stdout or "") + (proc.stderr or "")).strip()
    return {
        "passed": proc.returncode == 0,
        "output": output[:MAX_OUTPUT_CHARS],
    }
