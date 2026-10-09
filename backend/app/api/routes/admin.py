"""Admin / management API — control the platform: author and manage labs,
inspect learners, see stats.

Auth is intentionally light: if `ADMIN_TOKEN` is set, every endpoint requires a
matching `X-Admin-Token` header; if it's empty, the API is open (local dev).
"""

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import optional_user
from app.core.config import settings
from app.core.onboarding import assign_starting_pathways, pathways_for
from app.core.rbac import ROLES, can_onboard, is_platform_admin
from app.db.session import get_db
from app.labs import loader, registry
from app.labs.loader import definition_of, public_lab, validate_definition
from app.models import content_status
from app.models import (
    Achievement,
    Asset,
    Challenge,
    Course,
    Learner,
    LabRecord,
    SharingSession,
    StepCompletion,
)
from app.stacks import list_stacks, reload_stacks

from app.schemas.learner import LearnerOrgFields

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Allow if: an admin by any of the ways in, OR the admin token matches, OR
    nothing is configured (local dev).

    `learner_id` is the proven caller — IdentityMiddleware replaced whatever
    the request claimed before this ran. For that reason **no route guarded by
    this may name a path parameter `learner_id`**: FastAPI resolves a path
    parameter in preference to a query one, so the guard would be handed the id
    of the person being edited and would judge the caller by the target. That
    is how `PUT /admin/learners/{id}/role` answered "Admin access required." to
    an administrator — and would have accepted anyone editing an admin. Path
    parameters here are called `target_id`. It has to be consulted, because an
    administrator who signs in with an email and a password is an administrator:
    without this the whole /admin surface answered 403 to them unless they went
    and found the server's admin token, while /admin/switchboard — which checks
    the role instead — let them straight in. Two doors to the same room, one
    locked for no reason.
    """
    if settings.auth_enabled:
        user = optional_user(authorization)
        if user and user.is_admin:
            return
    if settings.admin_token and x_admin_token == settings.admin_token:
        return
    if is_platform_admin(db.get(Learner, learner_id) if learner_id else None):
        return
    # Fully open only when neither auth mechanism is configured — a local-dev
    # affordance that REQUIRE_ADMIN_AUTH turns off for shared environments.
    if not settings.require_admin_auth and not settings.auth_enabled and not settings.admin_token:
        return
    raise HTTPException(status_code=403, detail="Admin access required.")


def require_hr_or_admin(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """HR responsibles and admins may edit org profile fields."""
    if settings.auth_enabled:
        user = optional_user(authorization)
        if user and user.is_admin:
            return
    if settings.admin_token and x_admin_token == settings.admin_token:
        return
    viewer = db.get(Learner, learner_id) if learner_id else None
    if viewer and viewer.role in ("hr", "hr_lead", "admin"):
        return
    if not settings.require_admin_auth and not settings.auth_enabled and not settings.admin_token:
        return
    raise HTTPException(status_code=403, detail="HR or admin access required.")


@router.post("/digest/run")
def run_weekly_digest(
    learner_id: int | None = None,
    days: int = 7,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Send the weekly notification digest by email.

    Pass `learner_id` to send to a single person (great for testing); omit it to
    send to everyone with an email and activity in the window. Idempotent to run
    — it just re-sends. Wire a scheduler to hit this every Monday morning.
    """
    from app.core.digest import build_digest
    from app.core.mailer import send_email

    if learner_id:
        targets = [db.get(Learner, learner_id)]
    else:
        targets = db.query(Learner).filter(Learner.email.isnot(None)).all()

    sent, no_activity, no_email = 0, 0, 0
    for learner in targets:
        if not learner:
            continue
        if not learner.email:
            no_email += 1
            continue
        digest = build_digest(db, learner, days=days, frontend_origin=settings.frontend_origin)
        if not digest:
            no_activity += 1
            continue
        subject, html, text = digest
        if send_email(learner.email, subject, html, text):
            sent += 1
    return {
        "sent": sent,
        "skipped_no_activity": no_activity,
        "skipped_no_email": no_email,
        "mail_enabled": settings.mail_enabled,
    }


@router.post("/reminders/certifications")
def run_certification_reminders(
    days: int | None = None,
    force: bool = False,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Fire the certification renewal reminders now.

    The Celery beat schedule runs this daily; this endpoint is for testing and
    for catching up after downtime. `force` re-sends even when a reminder has
    already gone out for the current window."""
    from app.core.reminders import run_expiry_reminders

    return run_expiry_reminders(db, days=days, force=force)


# --------------------------------------------------------------------------- #
# Coursera                                                                    #
# --------------------------------------------------------------------------- #


class CourseraImportRequest(BaseModel):
    """Slugs are the tail of a coursera.org/learn/<slug> URL."""

    slugs: list[str] = []
    publish: bool = True
    learner_id: int | None = None


@router.get("/coursera/status")
def coursera_status(db: Session = Depends(get_db), _: None = Depends(require_admin)):
    """What this deployment can actually do with Coursera today.

    The catalog needs no credentials; reporting needs a Coursera for Business
    contract. Surfacing the difference stops "why is Jour-Homme still zero for
    external courses" turning into a debugging session.
    """
    return {
        "catalog": {
            "available": True,
            "auth_required": False,
            "note": "Public catalog — import courses with real cover art and workload.",
        },
        "reporting": {
            "mode": settings.coursera_mode,
            "configured": bool(settings.coursera_client_id and settings.coursera_org_id),
            "note": (
                "Enterprise enrollment/progress reporting requires a Coursera for "
                "Business contract with API access. Use COURSERA_MODE=mock to "
                "demo the pipeline without one."
            ),
            **_coursera_totals(db),
        },
    }


def _coursera_totals(db: Session) -> dict:
    """What the last syncs left behind — the admin page's "is it working?"."""
    from sqlalchemy import func

    from app.models import ExternalEnrollment

    q = db.query(ExternalEnrollment).filter(ExternalEnrollment.provider == "coursera")
    total = q.count()
    unmatched = q.filter(ExternalEnrollment.learner_id.is_(None)).count()
    last = db.query(func.max(ExternalEnrollment.synced_at)).filter(
        ExternalEnrollment.provider == "coursera"
    ).scalar()
    return {
        "enrollments": total,
        "unmatched": unmatched,
        "last_synced_at": last.isoformat() if last else None,
    }


@router.get("/coursera/lookup")
def coursera_lookup(slug: str, _: None = Depends(require_admin)):
    """Preview a Coursera course before importing it."""
    from app.connectors.coursera import CourseraCatalog

    with CourseraCatalog() as catalog:
        found = catalog.by_slug(slug.strip())
        if not found:
            raise HTTPException(status_code=404, detail=f"No Coursera course with slug '{slug}'.")
        found["partners"] = list(catalog.partner_names(found["partner_ids"]).values())
    return found


@router.get("/coursera/catalog")
def coursera_catalog(
    q: str = "",
    start: int = 0,
    limit: int = 24,
    pages: int = 4,
    _: None = Depends(require_admin),
):
    """Browse the public Coursera catalogue, with search.

    The catalogue API has no server-side text search — `q=search` answers 405,
    "finder 'search' not implemented" — so a query is matched here, over the
    pages we pull. `pages` caps how far that walk goes, because an unbounded
    scan of a catalogue this size is a request that never returns. The response
    says how many courses were actually looked at, so a thin result reads as
    "widen the search" rather than as "Coursera has nothing".
    """
    from app.connectors.coursera import CourseraCatalog

    needle = q.strip().lower()
    found: list[dict] = []
    scanned = 0
    exhausted = False
    with CourseraCatalog() as catalog:
        # An exact slug beats any amount of scanning.
        if needle and "/" not in needle and " " not in needle:
            direct = catalog.by_slug(needle)
            if direct:
                found.append(direct)

        cursor = start
        for _page in range(max(1, min(pages, 20))):
            batch = catalog.browse(limit=100, start=cursor)
            if not batch:
                exhausted = True
                break
            scanned += len(batch)
            cursor += len(batch)
            for item in batch:
                if any(item["external_url"] == f["external_url"] for f in found):
                    continue
                haystack = f"{item['title']} {item['summary']}".lower()
                if not needle or needle in haystack:
                    found.append(item)
            if not needle and len(found) >= limit:
                break
            if needle and len(found) >= limit:
                break

        for item in found[:limit]:
            item["partners"] = list(catalog.partner_names(item["partner_ids"]).values())

    return {
        "items": found[:limit],
        "next_start": cursor,
        "scanned": scanned,
        "exhausted": exhausted,
        # Stated rather than implied: this filtering is ours, not the provider's.
        "search_is_local": bool(needle),
    }


@router.post("/coursera/import")
def coursera_import(
    payload: CourseraImportRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Import Coursera courses into the catalog, cover art and all.

    Idempotent on `external_url`: re-importing refreshes an existing entry
    rather than duplicating it.
    """
    from app.connectors.coursera import CourseraCatalog
    from app.models import Course

    imported, updated, missing = [], [], []
    with CourseraCatalog() as catalog:
        for raw in payload.slugs:
            slug = raw.strip()
            if not slug:
                continue
            data = catalog.by_slug(slug)
            if not data:
                missing.append(slug)
                continue

            partners = list(catalog.partner_names(data["partner_ids"]).values())
            course = (
                db.query(Course).filter(Course.external_url == data["external_url"]).first()
            )
            existed = course is not None
            if not course:
                course = Course(title=data["title"])
                db.add(course)

            course.title = data["title"]
            course.summary = data["summary"]
            course.emoji = "🎓"
            course.provider = "Coursera"
            course.external_url = data["external_url"]
            course.cover_url = data["cover_url"]
            course.external_hours = data["estimated_hours"] or 0
            course.author = partners[0] if partners else "Coursera"
            course.status = content_status.PUBLISHED if payload.publish else content_status.DRAFT
            (updated if existed else imported).append(data["title"])

    db.commit()
    return {"imported": imported, "updated": updated, "not_found": missing}


@router.post("/coursera/import-enrolled")
def coursera_import_enrolled(
    limit: int = 300,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Put every course Tealers are actually enrolled in into the catalogue.

    The keyword import above fills the catalogue with what a search happened to
    surface. This fills it with what the organisation is really doing: the
    distinct courses behind the enrolment feed, busiest first, which is the set
    a learner expects to find when they look up something a colleague mentioned.

    It also writes `course_id` back onto the enrolment rows it can now resolve,
    so a learner's provider history links to a real catalogue entry instead of
    being a title with nowhere to go.

    Idempotent: slugs already in the catalogue are skipped, not re-fetched.
    """
    from sqlalchemy import func

    from app.connectors.coursera import CourseraCatalog
    from app.models import Course, ExternalEnrollment

    have = {c.external_url for c in db.query(Course).filter(Course.external_url != "")}
    ranked = (
        db.query(ExternalEnrollment.course_slug, func.count(ExternalEnrollment.id).label("n"))
        .filter(ExternalEnrollment.provider == "coursera")
        .filter(ExternalEnrollment.course_slug != "")
        .group_by(ExternalEnrollment.course_slug)
        .order_by(func.count(ExternalEnrollment.id).desc())
        .all()
    )
    wanted = [slug for slug, _ in ranked
              if f"https://www.coursera.org/learn/{slug}" not in have][:max(1, limit)]

    imported, missing = [], []
    with CourseraCatalog() as catalog:
        for slug in wanted:
            data = catalog.by_slug(slug)
            if not data:
                # A private or retired course. Expected at this volume, and the
                # enrolment row stays — it still counts towards hours and XP.
                missing.append(slug)
                continue
            partners = list(catalog.partner_names(data["partner_ids"]).values())
            course = Course(
                title=data["title"],
                summary=data["summary"],
                emoji="🎓",
                provider="Coursera",
                external_url=data["external_url"],
                cover_url=data["cover_url"],
                external_hours=data["estimated_hours"] or 0,
                author=partners[0] if partners else "Coursera",
                status=content_status.PUBLISHED,
            )
            db.add(course)
            imported.append(data["title"])
    db.commit()

    # Now that they exist, point the history at them.
    by_url = {c.external_url: c.id for c in db.query(Course).filter(Course.external_url != "")}
    linked = 0
    for row in db.query(ExternalEnrollment).filter(ExternalEnrollment.course_id.is_(None)):
        course_id = by_url.get(f"https://www.coursera.org/learn/{row.course_slug}")
        if course_id:
            row.course_id = course_id
            linked += 1
    db.commit()

    return {
        "distinct_enrolled": len(ranked),
        "imported": len(imported),
        "not_found": len(missing),
        "enrollments_linked": linked,
        "catalogue": db.query(Course).count(),
    }


class CourseraLinkIn(BaseModel):
    """`who` is an AIDA handle or email; `coursera_email` the provider account."""

    who: str
    coursera_email: str


@router.post("/coursera/link")
def coursera_link(
    payload: CourseraLinkIn,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Attach a Coursera account to a learner and backfill its history."""
    from app.core.coursera_link import link_learner

    who = payload.who.strip()
    learner = (
        db.query(Learner)
        .filter((Learner.handle.ilike(who)) | (Learner.email.ilike(who)))
        .first()
    )
    if not learner:
        raise HTTPException(status_code=404, detail=f"No learner '{who}'.")
    result = link_learner(db, learner, payload.coursera_email)
    if not result["linked"]:
        raise HTTPException(status_code=404, detail=result["reason"])
    return result


@router.post("/coursera/import-enrolled")
def coursera_import_enrolled(
    limit: int = 25,
    publish: bool = True,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Import the courses the organisation is actually enrolled in.

    The slug-by-slug import assumes somebody already knows which courses matter.
    After a sync we know: the enrolment rows name every course the company
    touches, and how many people are on each. This takes the most-enrolled ones
    and pulls their catalogue entry, so the AIDA catalogue reflects the real
    Coursera footprint instead of a hand-typed subset.

    Learning paths and videos are skipped: the catalogue API resolves courses.
    """
    from sqlalchemy import func

    from app.connectors.coursera import CourseraCatalog
    from app.models import Course, ExternalEnrollment

    ranked = (
        db.query(ExternalEnrollment.course_slug, func.count().label("n"))
        .filter(
            ExternalEnrollment.provider == "coursera",
            ExternalEnrollment.content_type == "Course",
            ExternalEnrollment.course_slug != "",
        )
        .group_by(ExternalEnrollment.course_slug)
        .order_by(func.count().desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )

    imported, updated, missing = [], [], []
    with CourseraCatalog() as catalog:
        for slug, _count in ranked:
            data = catalog.by_slug(slug)
            if not data:
                missing.append(slug)
                continue
            partners = list(catalog.partner_names(data["partner_ids"]).values())
            course = db.query(Course).filter(Course.external_url == data["external_url"]).first()
            existed = course is not None
            if not course:
                course = Course(title=data["title"])
                db.add(course)
            course.title = data["title"]
            course.summary = data["summary"]
            course.emoji = "🎓"
            course.provider = "Coursera"
            course.external_url = data["external_url"]
            course.cover_url = data["cover_url"]
            course.external_hours = data["estimated_hours"] or 0
            course.author = partners[0] if partners else "Coursera"
            course.status = content_status.PUBLISHED if publish else content_status.DRAFT
            (updated if existed else imported).append(data["title"])
    db.commit()
    return {
        "considered": len(ranked),
        "imported": imported,
        "updated": updated,
        "not_found": missing,
    }


@router.post("/coursera/sync")
def coursera_sync(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Pull enrollment/progress from Coursera into external_enrollments.

    Runs against fixtures in `mock` mode so the HR pipeline is demonstrable
    before a contract exists.
    """
    from app.connectors.coursera import CourseraReportingUnavailable
    from app.core.external_learning import sync_coursera

    try:
        return sync_coursera(db)
    except CourseraReportingUnavailable as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/tester-guide.pdf")
def tester_guide(
    base_url: str = "",
    _: None = Depends(require_admin),
):
    """The tester's guide, branded, for whoever is about to try the platform."""
    from fastapi.responses import Response

    from app.core import tester_guide as guide

    blob = guide.build(base_url or settings.frontend_origin)
    return Response(
        content=blob,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="upskill-guide-testeur.pdf"'},
    )


@router.get("/diagnostics")
def diagnostics(_: None = Depends(require_admin)):
    """The start-up report, on demand.

    It is already logged at boot, but reading a pod's log needs cluster access
    that whoever is asking "why did no email arrive" usually does not have.
    Same checks, same wording, no secrets: every value is a state, a hostname
    or a count.
    """
    from app.core.diagnostics import run_checks, config_summary
    from app.core.config import get_settings

    settings = get_settings()
    return {
        "summary": config_summary(settings),
        "mail": {
            "transport": settings.mail_transport,
            "sends_as": settings.mail_from_address,
            "enabled": settings.mail_enabled,
            "allowlist": settings.mail_allowlist_entries,
        },
        "checks": [
            {"name": c.name, "status": c.status, "target": c.target, "detail": c.detail}
            for c in run_checks("api", settings)
        ],
    }


@router.post("/coursera/rescore")
def coursera_rescore(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Recompute everyone's provider XP, so past learning sets a starting level.

    The nightly sync already does this for anybody whose rows it touched, which
    is why most people already carry it. This is the deterministic version, for
    after a bulk import or after linking accounts by hand: it replaces each
    learner's previous contribution rather than stacking another, so running it
    twice changes nothing.
    """
    from app.core.coursera_link import grant_coursera_xp
    from app.models import ExternalEnrollment

    ids = [
        i for (i,) in db.query(ExternalEnrollment.learner_id)
        .filter(ExternalEnrollment.learner_id.isnot(None))
        .distinct()
    ]
    scored = badges = 0
    for learner in db.query(Learner).filter(Learner.id.in_(ids or [0])).all():
        result = grant_coursera_xp(db, learner)
        scored += int(result["granted"] > 0)
        badges += len(result["new_badges"])
    return {"learners_seen": len(ids), "with_xp": scored, "badges_awarded": badges}


@router.post("/skills/seed-taxonomy")
def seed_skill_taxonomy(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Install the company-wide skill catalogue, and wire it to onboarding.

    The same thing `python -m app.ops_seed_skill_taxonomy` does, over HTTP —
    because a cluster is not always a kubectl away, and a migration cannot do
    this: it is content, not schema, and L&D may have edited it since.

    Idempotent and non-destructive: a skill that already exists keeps its id,
    and therefore every rating, follower and content link, while its domain and
    kind are corrected. Nothing is ever deleted.
    """
    from app.ops_seed_skill_taxonomy import main as seed

    seed()
    from app.models import Skill

    return {"skills": db.query(Skill).count()}


@router.post("/coursera/specializations")
def coursera_specializations(
    full: bool = False,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
):
    """Re-derive which multi-course programmes the completed courses add up to.

    The nightly sync does this already; this is for after a bulk import, or to
    pick up a programme whose membership the catalogue has changed. The first
    run costs one catalogue call per distinct completed course and takes a few
    minutes; later runs only look at courses no stored programme mentions.
    """
    from app.core import specializations

    return specializations.refresh(db, full=full)


class AdminLabIn(BaseModel):
    definition: dict
    published: bool = True


# ---- meta ----


@router.get("/auth")
def auth_check(_: None = Depends(require_admin)):
    return {"ok": True, "protected": bool(settings.admin_token)}


@router.get("/stats")
def stats(db: Session = Depends(get_db), _: None = Depends(require_admin)):
    file_count = len(loader.file_labs())
    db_count = db.query(LabRecord).count()
    published = db.query(LabRecord).filter(LabRecord.published.is_(True)).count()
    tracks = sorted({lab.track for lab in registry.all_labs(db)})
    return {
        "labs": {"file": file_count, "db": db_count, "published": published, "total_visible": len(registry.all_labs(db))},
        "tracks": tracks,
        "learners": db.query(Learner).count(),
        "completions": db.query(StepCompletion).count(),
        "badges_awarded": db.query(Achievement).count(),
        "total_xp": int(db.query(func.coalesce(func.sum(Learner.xp), 0)).scalar() or 0),
        "stacks": len(list_stacks()),
        "assets": db.query(Asset).count(),
        "courses": db.query(Course).count(),
        "challenges": db.query(Challenge).count(),
        "sessions": db.query(SharingSession).count(),
    }


# ---- labs management ----


@router.get("/labs")
def list_labs(db: Session = Depends(get_db), _: None = Depends(require_admin)):
    """Every lab, with its source and (for DB labs) publish state."""
    db_records = {r.id: r for r in db.query(LabRecord).all()}
    rows = []
    # File labs (read-only; editing makes a DB override of the same id).
    for lab in loader.file_labs().values():
        overridden = lab.id in db_records
        rows.append(
            {
                "id": lab.id,
                "title": lab.title,
                "track": lab.track,
                "difficulty": lab.difficulty,
                "steps": len(lab.steps),
                "total_xp": lab.total_xp,
                "source": "file",
                "published": True,
                "overridden": overridden,
            }
        )
    for rec in db_records.values():
        try:
            lab = loader.Lab.model_validate(rec.definition)
            rows.append(
                {
                    "id": rec.id,
                    "title": lab.title,
                    "track": lab.track,
                    "difficulty": lab.difficulty,
                    "steps": len(lab.steps),
                    "total_xp": lab.total_xp,
                    "source": "db",
                    "published": rec.published,
                    "overridden": False,
                }
            )
        except Exception:  # noqa: BLE001
            rows.append(
                {"id": rec.id, "title": "(invalid definition)", "track": "?", "difficulty": "?",
                 "steps": 0, "total_xp": 0, "source": "db", "published": rec.published, "overridden": False}
            )
    return rows


@router.get("/labs/{lab_id}")
def get_definition(lab_id: str, db: Session = Depends(get_db), _: None = Depends(require_admin)):
    """Full editable definition. DB labs win; otherwise the file lab's definition
    is returned so the editor can fork it into a DB override."""
    rec = db.get(LabRecord, lab_id)
    if rec:
        return {"definition": rec.definition, "published": rec.published, "source": "db"}
    lab = loader.file_labs().get(lab_id)
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    return {"definition": definition_of(lab), "published": True, "source": "file"}


@router.post("/labs/validate")
def validate(body: AdminLabIn, _: None = Depends(require_admin)):
    try:
        lab = validate_definition(body.definition)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "preview": public_lab(lab)}


@router.post("/labs", status_code=201)
def create(body: AdminLabIn, db: Session = Depends(get_db), _: None = Depends(require_admin)):
    try:
        lab = validate_definition(body.definition)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if db.get(LabRecord, lab.id):
        raise HTTPException(status_code=409, detail=f"A DB lab with id '{lab.id}' already exists.")
    rec = LabRecord(id=lab.id, definition=definition_of(lab), published=body.published)
    db.add(rec)
    db.commit()
    return {"id": lab.id, "published": rec.published}


@router.put("/labs/{lab_id}")
def update(lab_id: str, body: AdminLabIn, db: Session = Depends(get_db), _: None = Depends(require_admin)):
    body.definition["id"] = lab_id  # path is authoritative
    try:
        lab = validate_definition(body.definition)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    rec = db.get(LabRecord, lab_id)
    if rec:
        rec.definition = definition_of(lab)
        rec.published = body.published
    else:
        rec = LabRecord(id=lab_id, definition=definition_of(lab), published=body.published)
        db.add(rec)
    db.commit()
    return {"id": lab_id, "published": rec.published}


@router.delete("/labs/{lab_id}", status_code=204)
def delete(lab_id: str, db: Session = Depends(get_db), _: None = Depends(require_admin)):
    rec = db.get(LabRecord, lab_id)
    if not rec:
        raise HTTPException(status_code=404, detail="No DB lab with that id (file labs can't be deleted here).")
    db.delete(rec)
    db.commit()


@router.post("/labs/reload-files")
def reload_files(_: None = Depends(require_admin)):
    return {"loaded": loader.reload_labs(), "stacks": reload_stacks()}


# ---- learners management ----


@router.get("/learners")
def list_learners(
    learner_id: int | None = None,
    db: Session = Depends(get_db),
    _: None = Depends(require_hr_or_admin),
):
    out = []
    for learner in db.query(Learner).order_by(Learner.xp.desc()).all():
        out.append(
            {
                "id": learner.id,
                "handle": learner.handle,
                "role": learner.role,
                "xp": learner.xp,
                "completions": db.query(StepCompletion).filter(StepCompletion.learner_id == learner.id).count(),
                "badges": db.query(Achievement).filter(Achievement.learner_id == learner.id).count(),
                "bu": learner.bu,
                "practice": learner.practice,
                "location": learner.location,
                "matricule": learner.matricule,
                "job_level": learner.job_level,
            }
        )
    return out


@router.put("/learners/{target_id}/role")
def set_learner_role(
    target_id: int, role: str, db: Session = Depends(get_db), _: None = Depends(require_admin)
):
    """Grant or revoke a role: trainer (runs formations), manager / bu_head
    (run their team), hr (org-wide people view), or admin."""
    if role not in ROLES:
        raise HTTPException(
            status_code=400, detail="Role must be one of: " + ", ".join(ROLES) + "."
        )
    learner = db.get(Learner, target_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    learner.role = role
    db.commit()
    return {"id": learner.id, "handle": learner.handle, "role": learner.role}


@router.put("/learners/{target_id}/profile")
def set_learner_profile(
    target_id: int,
    payload: LearnerOrgFields,
    db: Session = Depends(get_db),
    _: None = Depends(require_hr_or_admin),
):
    """Set HR org axes (BU, practice, location, matricule, job level)."""
    learner = db.get(Learner, target_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    learner.bu = payload.bu.strip()
    learner.practice = payload.practice.strip()
    learner.location = payload.location.strip()
    learner.matricule = payload.matricule.strip()
    learner.job_level = payload.job_level.strip()
    db.commit()
    return {
        "id": learner.id,
        "handle": learner.handle,
        "bu": learner.bu,
        "practice": learner.practice,
        "location": learner.location,
        "matricule": learner.matricule,
        "job_level": learner.job_level,
    }


@router.delete("/learners/{target_id}", status_code=204)
def delete_learner(target_id: int, db: Session = Depends(get_db), _: None = Depends(require_admin)):
    learner = db.get(Learner, target_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    db.delete(learner)
    db.commit()


# --------------------------------------------------------------------------- #
# onboarding a new collaborator                                               #
# --------------------------------------------------------------------------- #


class RecruitIn(BaseModel):
    """A new joiner, as L&D would type them in on their first morning."""

    learner_id: int | None = None  # the L&D person doing this
    handle: str = Field(min_length=2, max_length=60)
    name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=255)
    bu: str = ""
    practice: str = ""
    location: str = ""
    matricule: str = ""
    job_level: str = ""
    team_id: int | None = None
    # Pathways are assigned unless someone explicitly does not want them; the
    # default is the whole point of the feature.
    assign_pathways: bool = True


@router.post("/recruits", status_code=201)
def recruit(
    payload: RecruitIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Create a collaborator and start them on their pathways.

    Restricted to L&D and admins. Deliberately not open to HRBPs or managers:
    an HRBP reports on their perimeter rather than opening accounts for it, and
    account creation is the one action that decides who exists on the platform
    at all.

    The recruit lands on the company-wide pathways plus the ones for the BU they
    joined, and is told so. The alternative — L&D remembering to assign a path
    to every joiner — works until the week it does not, and the person who finds
    out is the recruit staring at an empty dashboard.
    """
    actor = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not can_onboard(actor, x_admin_token):
        raise HTTPException(
            status_code=403,
            detail="Only L&D or an admin can add a collaborator.",
        )

    handle = payload.handle.strip().lower()
    if db.query(Learner).filter(Learner.handle.ilike(handle)).first():
        raise HTTPException(status_code=409, detail=f"'{handle}' already exists.")

    person = Learner(
        handle=handle,
        name=payload.name.strip() or handle,
        email=payload.email.strip(),
        role="user",
        bu=payload.bu.strip(),
        practice=payload.practice.strip(),
        location=payload.location.strip(),
        matricule=payload.matricule.strip(),
        job_level=payload.job_level.strip(),
        team_id=payload.team_id,
    )
    db.add(person)
    db.flush()

    assigned = (
        assign_starting_pathways(
            db, person, assigned_by=(actor.name or actor.handle) if actor else "L&D"
        )
        if payload.assign_pathways
        else []
    )
    db.commit()
    db.refresh(person)

    return {
        "id": person.id,
        "handle": person.handle,
        "name": person.name,
        "bu": person.bu,
        "team_id": person.team_id,
        "pathways": [
            {"id": p.id, "title": p.title, "mandatory": p.mandatory} for p in assigned
        ],
        # Zero here is worth seeing: it means nothing is set to auto-assign for
        # this BU, so the recruit really did land on an empty plan.
        "pathways_assigned": len(assigned),
    }


@router.get("/recruits/preview")
def recruit_preview(
    bu: str = "",
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """What a joiner in this BU would be given, before anyone is created."""
    actor = db.get(Learner, learner_id) if learner_id else None
    if not can_onboard(actor, x_admin_token):
        raise HTTPException(
            status_code=403, detail="Only L&D or an admin can add a collaborator."
        )
    probe = Learner(handle="__preview__", bu=bu.strip())
    rows = pathways_for(db, probe)
    return {
        "bu": bu.strip(),
        "pathways": [
            {
                "id": p.id,
                "title": p.title,
                "emoji": p.emoji,
                "mandatory": p.mandatory,
                "scope": p.audience_bu or "all",
            }
            for p in rows
        ],
    }
