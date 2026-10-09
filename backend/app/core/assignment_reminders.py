"""Daily nudges for mandatory work that is still open.

Assigning something mandatory and never mentioning it again is how compliance
figures end up red at the end of a quarter with nobody having been told. The
campaign tells people once, on the day; this is what keeps it in front of them
until it is done.

The rules, and the reasoning behind each:

* **Only mandatory, only with a deadline.** A recommendation is a suggestion,
  and an obligation with no date can never be late — chasing either would train
  people to ignore the mail.
* **Only what is unfinished.** Progress is read the same way the tracking board
  reads it, so somebody who finished on the provider is not chased for it here.
* **Once a day at most**, enforced by `last_reminded_on` rather than by trusting
  the scheduler: beat restarts, retries and a manual run must not produce three
  messages in an afternoon.
* **Email stops, the app does not.** Daily mail until the deadline, then one
  message the day it becomes overdue, then weekly — and never beyond
  `STOP_EMAIL_AFTER_DAYS` overdue. The in-app notification keeps going, because
  it costs the reader nothing to leave unread, and the compliance board is
  where chasing properly belongs after two weeks.
* **Quiet first days.** Nothing is sent while the deadline is further away than
  `START_WITHIN_DAYS`: a reminder two months early is noise that teaches people
  the reminders do not matter.
"""

from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email_template import Button, render_email
from app.core.i18n import tr
from app.core.mailer import send_email
from app.core.notifier import notify
from app.models import CourseAssignment, Learner

log = logging.getLogger(__name__)

# Start reminding this many days before the deadline.
START_WITHIN_DAYS = 14
# After this many days overdue, stop mailing; the board takes over.
STOP_EMAIL_AFTER_DAYS = 14
# Once overdue, mail on these days only (1 = the day it slipped).
OVERDUE_MAIL_DAYS = (1, 7, 14)


def _plain(html: str) -> str:
    """The in-app bell shows text, not markup, so the <b> has to go."""
    return html.replace("<b>", "").replace("</b>", "")


def _title_and_link(db: Session, kind: str, entity_id: int) -> tuple[str, str]:
    from app.api.routes.assignments import _link, _title
    from fastapi import HTTPException

    try:
        return _title(db, kind, entity_id), _link(kind, entity_id)
    except HTTPException:
        # The content was deleted; the assignment is stale and not worth a mail.
        return "", ""


def _is_done(db: Session, row: CourseAssignment) -> bool:
    from app.api.routes.assignments import _progress

    done, total = _progress(db, row.entity_type, row.entity_id, row.learner_id)
    return total > 0 and done >= total


def run_assignment_reminders(db: Session, today: dt.date | None = None) -> dict:
    """One pass. Returns what it did, so the task log says something useful."""
    today = today or dt.date.today()
    rows = (
        db.query(CourseAssignment)
        .filter(CourseAssignment.mandatory.is_(True))
        .filter(CourseAssignment.due_date.isnot(None))
        # Accepted as done by L&D: chasing somebody for work that has already
        # been agreed as finished is the behaviour the acceptance exists to end.
        .filter(CourseAssignment.accepted_on.is_(None))
        .all()
    )

    notified = mailed = skipped_done = 0
    for row in rows:
        if row.last_reminded_on == today:
            continue

        days_left = (row.due_date - today).days
        if days_left > START_WITHIN_DAYS:
            continue
        overdue_days = -days_left

        if _is_done(db, row):
            skipped_done += 1
            continue

        learner = db.get(Learner, row.learner_id)
        if not learner:
            continue
        title, link = _title_and_link(db, row.entity_type, row.entity_id)
        if not title:
            continue

        late = days_left < 0
        notify(
            db,
            [learner.id],
            kind="assignment_due",
            title=("⚠️ " if late else "⏳ ") + title,
            # Every variable the template names has to be passed: tr() leaves
            # the whole string untouched when one is missing, which shows the
            # reader a literal {title}.
            body=_plain(tr(
                learner,
                "due.overdue.body" if late else "due.soon.body",
                title=title,
                n=abs(days_left),
                date=f"{row.due_date:%d/%m/%Y}",
            )),
            link=link,
        )
        notified += 1
        row.last_reminded_on = today

        wants_mail = (
            learner.email
            and settings.mail_enabled
            and (not late or (overdue_days in OVERDUE_MAIL_DAYS and overdue_days <= STOP_EMAIL_AFTER_DAYS))
        )
        if wants_mail:
            _mail(learner, title, link, row, days_left)
            mailed += 1

    db.commit()
    result = {"checked": len(rows), "notified": notified, "mailed": mailed, "already_done": skipped_done}
    log.info("assignment reminders: %s", result)
    return result


def _mail(learner: Learner, title: str, link: str, row: CourseAssignment, days_left: int) -> None:
    late = days_left < 0
    key = "due.overdue" if late else "due.soon"
    # Every variable the subject names has to be passed, not only the ones the
    # body uses: tr() leaves the string untouched when one is missing, and the
    # due-soon subject counts days — so a missing `n` put the literal
    # "À faire dans {n} jour(s) : {title}" in people's inboxes.
    heading = tr(
        learner,
        f"{key}.subject",
        title=title,
        n=abs(days_left),
        date=f"{row.due_date:%d/%m/%Y}",
    )
    blocks: list = [
        ("p", tr(learner, f"{key}.body", title=title, n=abs(days_left),
                 date=f"{row.due_date:%d/%m/%Y}")),
        ("stats", [(tr(learner, "assign.due"), f"{row.due_date:%d/%m/%Y}")]),
    ]
    if row.note:
        blocks.append(("note", row.note))
    html, text = render_email(
        heading=heading,
        preheader=heading,
        blocks=blocks,
        button=Button(tr(learner, "due.cta"), f"{settings.frontend_origin}{link}"),
        footer_note=tr(learner, "due.footer", who=row.assigned_by or "L&D"),
    )
    send_email(learner.email, f"[{settings.app_name}] {heading}", html, text)
