"""What a manager hears about their team's mandatory work.

Managers asked to know two things: when work is handed to their people, and
when a deadline is coming and somebody has not finished. Both are easy to build
and easy to get wrong — a message per person per item per day turns into a
dozen mails a morning, and the fifth one is already being filtered to a folder
nobody opens.

So the rule here is **one message per manager per day, at most**, and it is a
list rather than a notification:

* **On assignment** — one summary per manager per campaign, naming the people
  and what they were given. L&D assigning a pathway to twelve people sends
  twelve learner mails and *one* manager mail, not twelve.
* **Before a deadline** — a daily sweep that collects everything crossing a
  threshold and sends one digest. The thresholds are deliberately few:
  `ALERT_DAYS` before, then the day it slips, then once a week. A manager who
  is told at 3 days, 1 day and on the day it goes late has been told three
  times; a manager told every day has been told nothing.

What is never sent: optional assignments (a recommendation is not a compliance
matter), items already finished, and items L&D has accepted as done on evidence
outside the platform. Each of those would be a message asking somebody to chase
work that needs no chasing, which is how a channel loses its credibility.

Who counts as the manager: the manager of the person's team, falling back to
the team lead. Not the BU head — one unit is hundreds of people, and a digest
nobody can act on line by line is a report, not an alert.
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
from app.models import CourseAssignment, Learner, Team

log = logging.getLogger(__name__)

# Days before the deadline that are worth a manager's attention. Three touches
# is a rhythm; seven is noise.
ALERT_DAYS = (3, 1)
# Once late: the day it slips, then weekly, then the compliance board owns it.
OVERDUE_DAYS = (1, 7)
STOP_AFTER_DAYS = 14


def manager_of(db: Session, learner: Learner) -> Learner | None:
    """The person who should hear about this learner's mandatory work."""
    if not learner.team_id:
        return None
    team = db.get(Team, learner.team_id)
    if not team:
        return None
    head_id = team.manager_id or team.lead_id
    if not head_id or head_id == learner.id:
        # Nobody manages themselves into a to-do list.
        return None
    return db.get(Learner, head_id)


def _tell(db: Session, manager: Learner, title: str, lines: list[str], cta: str) -> bool:
    """One notification and, when mail is on, one email. Returns True if mailed."""
    notify(
        db, [manager.id], kind="team_mandatory",
        title=title,
        body=" · ".join(lines[:3]) + (f" …+{len(lines) - 3}" if len(lines) > 3 else ""),
        link="/mandatory",
    )
    if not (manager.email and settings.mail_enabled):
        return False
    html, text = render_email(
        heading=title,
        preheader=title,
        blocks=[("p", cta), ("list", lines)],
        button=Button(tr(manager, "team.cta"), f"{settings.frontend_origin}/mandatory"),
        footer_note=tr(manager, "team.footer"),
    )
    return bool(send_email(manager.email, f"[{settings.app_name}] {title}", html, text))


def announce_campaign(db: Session, assigned: dict[int, list[tuple[str, str]]],
                      by: str, due: dt.date | None, mandatory: bool) -> int:
    """Tell each manager what their people were just given. One mail each.

    `assigned` is the campaign's own map of learner id -> [(title, link)], so
    this says exactly what the learners were told, with no second arithmetic.
    """
    if not mandatory:
        # A recommendation is between L&D and the learner.
        return 0
    by_manager: dict[int, tuple[Learner, list[str]]] = {}
    for learner_id, items in assigned.items():
        if not items:
            continue
        learner = db.get(Learner, learner_id)
        manager = manager_of(db, learner) if learner else None
        if not manager:
            continue
        entry = by_manager.setdefault(manager.id, (manager, []))
        name = learner.name or learner.handle
        for title, _link in items:
            entry[1].append(f"{name} — {title}")

    mailed = 0
    deadline = f" · {due:%d/%m/%Y}" if due else ""
    for manager, lines in by_manager.values():
        heading = tr(manager, "team.assigned.subject", n=len(lines))
        mailed += int(_tell(
            db, manager, heading + deadline, lines,
            tr(manager, "team.assigned.body", who=by),
        ))
    db.commit()
    log.info("manager alerts: %s managers told about a campaign", len(by_manager))
    return len(by_manager)


def run_deadline_digest(db: Session, today: dt.date | None = None) -> dict:
    """One pass: every manager hears once about what is about to be late."""
    from app.api.routes.assignments import _progress, _title

    today = today or dt.date.today()
    rows = (
        db.query(CourseAssignment)
        .filter(CourseAssignment.mandatory.is_(True))
        .filter(CourseAssignment.due_date.isnot(None))
        .filter(CourseAssignment.accepted_on.is_(None))
        .all()
    )

    by_manager: dict[int, tuple[Learner, list[str]]] = {}
    for row in rows:
        days_left = (row.due_date - today).days
        overdue_days = -days_left
        due_soon = days_left in ALERT_DAYS
        late = overdue_days in OVERDUE_DAYS and overdue_days <= STOP_AFTER_DAYS
        if not (due_soon or late):
            continue

        done, total = _progress(db, row.entity_type, row.entity_id, row.learner_id)
        if total > 0 and done >= total:
            continue

        learner = db.get(Learner, row.learner_id)
        manager = manager_of(db, learner) if learner else None
        if not manager:
            continue
        try:
            title = _title(db, row.entity_type, row.entity_id)
        except Exception:  # noqa: BLE001 — the content was deleted; the row is stale
            continue

        percent = round(100 * done / total) if total else 0
        when = (
            tr(learner, "team.line.late", n=overdue_days)
            if late else tr(learner, "team.line.soon", n=days_left)
        )
        entry = by_manager.setdefault(manager.id, (manager, []))
        entry[1].append(f"{learner.name or learner.handle} — {title} — {when} — {percent}%")

    mailed = 0
    for manager, lines in by_manager.values():
        if manager.manager_digest_on == today:
            # The sweep was already run today. Beat restarts and manual runs
            # must not produce a second digest in an afternoon.
            continue
        heading = tr(manager, "team.due.subject", n=len(lines))
        mailed += int(_tell(db, manager, heading, lines, tr(manager, "team.due.body")))
        manager.manager_digest_on = today
    db.commit()

    result = {"checked": len(rows), "managers": len(by_manager), "mailed": mailed}
    log.info("manager deadline digest: %s", result)
    return result
