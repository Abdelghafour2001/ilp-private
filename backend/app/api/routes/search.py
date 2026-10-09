"""One search across everything a person can learn from.

There was a command palette, but it searched the navigation menu: typing "RAG"
jumped you to a page rather than finding the training, the lab and the talk
about it. With 833 courses in the catalogue that stopped being a gap and became
the main way content is lost.

Titles, summaries and tags, across the eight kinds of thing the platform holds.
Draft and archived content stays out: an unpublished course is not a search
result, it is somebody's work in progress.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import (
    Asset,
    Certification,
    Challenge,
    Course,
    Formation,
    LabRecord,
    Learner,
    Pathway,
    SharingSession,
    Skill,
    content_status,
)

router = APIRouter(prefix="/search", tags=["search"])

# What each kind is called and where a hit leads. Order matters: it is the
# order results are grouped in, learning first and community after.
KINDS = ("course", "formation", "pathway", "lab", "session", "challenge", "asset", "certification", "skill")


def _hit(kind: str, id_, title: str, detail: str, link: str, meta: str = "") -> dict:
    return {
        "kind": kind,
        "id": id_,
        "title": title or "",
        "detail": (detail or "")[:180],
        "link": link,
        "meta": meta,
    }


@router.get("")
def search(
    q: str = "",
    kind: str = "",
    limit: int = Query(default=40, ge=1, le=200),
    learner_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Everything matching `q`, grouped by what kind of thing it is."""
    needle = q.strip()
    if len(needle) < 2:
        # One letter matches most of the catalogue, which is not an answer.
        return {"query": needle, "total": 0, "groups": [], "truncated": False}
    like = f"%{needle}%"
    want = {k for k in kind.split(",") if k} or set(KINDS)
    hits: list[dict] = []

    def text_match(*columns):
        return or_(*[c.ilike(like) for c in columns])

    if "course" in want:
        for row in (
            db.query(Course)
            .filter(Course.status.in_(content_status.VISIBLE))
            .filter(text_match(Course.title, Course.summary, Course.domain))
            .limit(limit)
        ):
            hits.append(_hit(
                "course", row.id, row.title, row.summary, f"/courses/{row.id}",
                " · ".join(x for x in (row.provider, row.level) if x),
            ))

    if "formation" in want:
        for row in (
            db.query(Formation)
            .filter(Formation.status == content_status.PUBLISHED)
            .filter(text_match(Formation.title, Formation.summary))
            .limit(limit)
        ):
            hits.append(_hit(
                "formation", row.id, row.title, row.summary, f"/formations/{row.id}",
                row.trainer_name or "",
            ))

    if "pathway" in want:
        for row in (
            db.query(Pathway)
            .filter(Pathway.status.in_(content_status.VISIBLE))
            .filter(text_match(Pathway.title, Pathway.summary))
            .limit(limit)
        ):
            hits.append(_hit("pathway", row.id, row.title, row.summary, f"/pathways"))

    if "lab" in want:
        for row in db.query(LabRecord).filter(LabRecord.published.is_(True)).limit(500):
            definition = row.definition or {}
            blob = f"{definition.get('title', '')} {definition.get('summary', '')}"
            if needle.lower() in blob.lower() or needle.lower() in row.id.lower():
                hits.append(_hit(
                    "lab", row.id, definition.get("title") or row.id,
                    definition.get("summary", ""), f"/labs/{row.id}",
                    definition.get("track", ""),
                ))

    if "session" in want:
        for row in (
            db.query(SharingSession)
            .filter(text_match(SharingSession.title, SharingSession.abstract, SharingSession.presenter))
            .limit(limit)
        ):
            hits.append(_hit(
                "session", row.id, row.title, row.abstract, f"/sessions/{row.id}", row.presenter or "",
            ))

    if "challenge" in want:
        for row in (
            db.query(Challenge).filter(text_match(Challenge.title, Challenge.summary)).limit(limit)
        ):
            hits.append(_hit(
                "challenge", row.id, row.title, row.summary, f"/challenges/{row.id}", row.status,
            ))

    if "asset" in want:
        for row in (
            db.query(Asset)
            .filter(Asset.status == "approved")
            .filter(text_match(Asset.title, Asset.summary))
            .limit(limit)
        ):
            hits.append(_hit("asset", row.id, row.title, row.summary, f"/assets/{row.id}", row.author or ""))

    if "certification" in want:
        for row in (
            db.query(Certification)
            .filter(text_match(Certification.name, Certification.provider, Certification.description))
            .limit(limit)
        ):
            hits.append(_hit(
                "certification", row.id, row.name, row.description or "", "/certifications",
                row.provider or "",
            ))

    if "skill" in want:
        for row in db.query(Skill).filter(text_match(Skill.name)).limit(limit):
            hits.append(_hit("skill", row.id, row.name, "", "/skills", ""))

    # A title match beats a mention buried in a summary.
    lowered = needle.lower()
    hits.sort(key=lambda h: (not h["title"].lower().startswith(lowered), lowered not in h["title"].lower()))

    groups = []
    for k in KINDS:
        rows = [h for h in hits if h["kind"] == k]
        if rows:
            groups.append({"kind": k, "count": len(rows), "items": rows[:limit]})

    return {
        "query": needle,
        "total": len(hits),
        "groups": groups,
        "truncated": any(g["count"] > limit for g in groups),
    }
