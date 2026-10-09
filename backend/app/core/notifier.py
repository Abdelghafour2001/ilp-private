"""Create in-app notifications. Callers pass the recipients; this helper only
inserts rows (the caller commits with the rest of its transaction)."""

from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.models import Notification


def notify(
    db: Session,
    learner_ids: Iterable[int],
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    exclude: int | None = None,
) -> int:
    """Queue one notification per recipient (deduped, `exclude` skipped)."""
    n = 0
    for lid in {i for i in learner_ids if i and i != exclude}:
        db.add(Notification(learner_id=lid, kind=kind, title=title[:255], body=body[:500], link=link[:255]))
        n += 1
    return n
