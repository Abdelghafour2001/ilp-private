"""Create (or promote) a platform administrator with a password.

The bootstrap problem: every way of granting the admin role goes through
somebody who already has it, and a fresh deployment has nobody. The server's
`ADMIN_TOKEN` is the way out over HTTP, but it only works while the token is to
hand and it leaves no account behind — so the first real admin is made here,
once, from inside the container.

The password is read from the environment and never written down in the
repository:

    kubectl exec -n <ns> deploy/ilp-backend -- env \\
        ADMIN_EMAIL=upskill-admin@teal.ma ADMIN_PASSWORD='...' \\
        python -m app.ops_make_admin

Locally:

    podman exec -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... <backend> \\
        python -m app.ops_make_admin

Idempotent: run it again to reset the password or to re-promote the account.
Note `ADMIN_EMAILS` in the configmap is a different thing — it makes somebody an
admin *when they arrive through Entra SSO*, and grants nothing to a password
account, which needs the role on its own row. This is what puts it there.
"""

from __future__ import annotations

import datetime as dt
import os

from app.core import passwords
from app.db.session import SessionLocal
from app.models import Learner


def main() -> None:
    email = os.environ["ADMIN_EMAIL"].strip()
    password = os.environ["ADMIN_PASSWORD"]
    problem = passwords.complaint(password)
    assert not problem, problem

    db = SessionLocal()
    learner = db.query(Learner).filter(Learner.email.ilike(email)).first()
    if not learner:
        # The handle is the local part of the address: it is what the demo
        # sign-in and every @mention use, and it has to be unique.
        learner = Learner(
            handle=email.split("@")[0],
            name=email.split("@")[0].replace(".", " ").replace("-", " ").title(),
            email=email,
        )
        db.add(learner)
        print(f"created {learner.handle}")

    learner.role = "admin"
    learner.password_hash = passwords.hash_password(password)
    learner.password_set_at = dt.datetime.now(dt.timezone.utc)
    # A locked-out account stays locked after a reset otherwise, which looks
    # exactly like the new password not having been set.
    learner.failed_logins = 0
    learner.locked_until = None
    db.commit()
    print(f"admin: {learner.email} (learner {learner.id}, handle {learner.handle})")


if __name__ == "__main__":
    main()
