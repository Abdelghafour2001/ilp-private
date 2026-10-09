"""Unified view over both lab sources: file-based (curated, PR'd) and
DB-managed (created/edited in the admin UI).

DB labs override file labs of the same id, so a maintainer can fork-and-edit a
curated lab in-app. Everything downstream (catalog, grading, tutor) goes through
here so it sees both sources transparently.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.labs import loader
from app.labs.loader import Lab
from app.models import LabRecord


def _db_labs(db: Session, include_unpublished: bool = False) -> dict[str, Lab]:
    q = db.query(LabRecord)
    if not include_unpublished:
        q = q.filter(LabRecord.published.is_(True))
    out: dict[str, Lab] = {}
    for rec in q.all():
        try:
            out[rec.id] = Lab.model_validate(rec.definition)
        except Exception:  # noqa: BLE001 - a broken DB lab shouldn't kill the catalog
            continue
    return out


def all_labs(db: Session) -> list[Lab]:
    merged = dict(loader.file_labs())
    merged.update(_db_labs(db))  # DB overrides file by id
    return list(merged.values())


def get_lab(db: Session, lab_id: str) -> Lab | None:
    db_labs = _db_labs(db)
    if lab_id in db_labs:
        return db_labs[lab_id]
    return loader.file_labs().get(lab_id)
