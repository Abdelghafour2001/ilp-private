"""Celery worker + beat schedule.

The dependency was in `requirements.txt` from the start but nothing ever ran
it, so every "automatic" job was really a manual endpoint call. This wires the
two recurring jobs the platform needs:

* certification renewal reminders — daily
* the weekly learning digest — Monday morning

Run alongside the API (see docker-compose services `worker` and `beat`):

    celery -A app.tasks worker --loglevel=info
    celery -A app.tasks beat   --loglevel=info

Times are UTC; adjust the crontab if the business wants Morocco local time.
"""

import logging

from celery import Celery
from celery.schedules import crontab
from celery.signals import beat_init, celeryd_init

from app.core.config import settings
from app.db.session import SessionLocal

log = logging.getLogger(__name__)

celery_app = Celery("aida", broker=settings.redis_url, backend=settings.redis_url)


def _log_diagnostics(role: str) -> None:
    if not logging.getLogger().handlers:
        # Celery has not set up logging yet at this point of the start.
        logging.basicConfig(level=logging.INFO, format="[%(asctime)s: %(levelname)s/diagnostics] %(message)s")
    from app.core.diagnostics import log_report

    log_report(role)


@celeryd_init.connect
def _worker_diagnostics(**_kwargs) -> None:
    # Fires before the worker connects to Redis, so a broker outage is still explained.
    _log_diagnostics("worker")


@beat_init.connect
def _beat_diagnostics(**_kwargs) -> None:
    _log_diagnostics("beat")

celery_app.conf.update(
    timezone="UTC",
    task_acks_late=True,
    worker_max_tasks_per_child=200,
    beat_schedule={
        "certification-renewal-reminders": {
            "task": "app.tasks.certification_reminders",
            "schedule": crontab(hour=7, minute=0),  # every day 07:00 UTC
        },
        "coursera-sync": {
            "task": "app.tasks.coursera_sync",
            # Nightly before the digest, or every COURSERA_SYNC_MINUTES while a
            # process is being tested and somebody is watching a board for a
            # learner's first click.
            "schedule": (
                crontab(minute=f"*/{settings.coursera_sync_minutes}")
                if settings.coursera_sync_minutes
                else crontab(hour=5, minute=0)
            ),
        },
        "coursera-specializations-full": {
            # The sync itself only asks the catalogue about new completions. Once
            # a day, ask about all of them: a course already known to one
            # programme may have been added to another, and only a full pass
            # sees that.
            "task": "app.tasks.coursera_specializations",
            "schedule": crontab(hour=5, minute=40),
        },
        "mandatory-assignment-reminders": {
            "task": "app.tasks.assignment_reminders",
            # An hour after the certificate sweep, so a person with both gets
            # them in one batch rather than spread across the morning.
            "schedule": crontab(hour=8, minute=0),
        },
        "team-deadline-digest": {
            # Half an hour after the learners are chased: a manager reading it
            # knows their people have already been told.
            "task": "app.tasks.manager_deadline_digest",
            "schedule": crontab(hour=8, minute=30),
        },
        "weekly-learning-digest": {
            "task": "app.tasks.weekly_digest",
            "schedule": crontab(hour=6, minute=30, day_of_week=1),  # Mondays
        },
    },
)


@celery_app.task(name="app.tasks.assignment_reminders")
def assignment_reminders() -> dict:
    """Chase everyone with mandatory work still open near its deadline."""
    from app.core.assignment_reminders import run_assignment_reminders
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        return run_assignment_reminders(db)


@celery_app.task(name="app.tasks.certification_reminders")
def certification_reminders(days: int | None = None) -> dict:
    """Nudge everyone whose certificate expires inside the reminder window."""
    from app.core.reminders import run_expiry_reminders

    db = SessionLocal()
    try:
        return run_expiry_reminders(db, days=days)
    finally:
        db.close()


@celery_app.task(name="app.tasks.coursera_sync")
def coursera_sync() -> dict:
    """Pull Coursera enrollment/progress so external learning counts.

    A no-op unless COURSERA_MODE is set; with `mock` it runs against fixtures,
    which keeps the nightly path exercised before a contract exists.
    """
    from app.connectors.coursera import CourseraReportingUnavailable
    from app.core.external_learning import sync_coursera

    db = SessionLocal()
    try:
        return sync_coursera(db)
    except CourseraReportingUnavailable as exc:
        log.info("coursera sync skipped: %s", exc)
        return {"skipped": str(exc)}
    finally:
        db.close()


@celery_app.task(name="app.tasks.coursera_specializations")
def coursera_specializations() -> dict:
    """Re-derive which multi-course programmes the completed courses add up to."""
    from app.core import specializations

    with SessionLocal() as db:
        return specializations.refresh(db, full=True)


@celery_app.task(name="app.tasks.manager_deadline_digest")
def manager_deadline_digest() -> dict:
    """Tell each manager, once, what in their team is about to be late."""
    from app.core.manager_alerts import run_deadline_digest

    with SessionLocal() as db:
        return run_deadline_digest(db)


@celery_app.task(name="app.tasks.weekly_digest")
def weekly_digest(days: int = 7) -> dict:
    """Email each learner a summary of their week."""
    from app.core.digest import build_digest
    from app.core.mailer import send_email
    from app.models import Learner

    db = SessionLocal()
    try:
        sent = 0
        for learner in db.query(Learner).filter(Learner.email.isnot(None)).all():
            digest = build_digest(
                db, learner, days=days, frontend_origin=settings.frontend_origin
            )
            if not digest:
                continue
            subject, html, text = digest
            if send_email(learner.email, subject, html, text):
                sent += 1
        log.info("weekly digest sent to %s learners", sent)
        return {"sent": sent, "mail_enabled": settings.mail_enabled}
    finally:
        db.close()
