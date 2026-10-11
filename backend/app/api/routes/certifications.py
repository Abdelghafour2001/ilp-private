"""Certifications — a shared catalog, team suggestions, and a recognition wall.

Three pieces:
- catalog: certifications worth pursuing, curated by trainers/leads/managers/admins
- suggestions: a Skill Lead or manager flags a catalog cert for their team
- earned wall: any learner shares a certificate they obtained (file and/or URL)
  so achievements are visible instead of buried in inboxes.
"""

import datetime as dt
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy import or_ as sa_or
from sqlalchemy.orm import Session

from app.core.cert_expiry import expiry_from_validity
from app.core import manager_alerts
from app.core.config import settings
from app.core.notifier import notify
from app.core.rbac import oversight_scope
from app.db.session import get_db
from app.models import (
    Certification,
    CertificationSuggestion,
    EarnedCertificate,
    Learner,
    Team,
)
from app.schemas.certification import (
    CertificationCreate,
    CertificationOut,
    EarnedCreate,
    EarnedOut,
    SuggestionOut,
    SuggestRequest,
)

router = APIRouter(prefix="/certifications", tags=["certifications"])

ALLOWED_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB — certificates are small documents


def _uploads_dir() -> Path:
    p = Path(settings.uploads_dir)
    if not p.is_absolute():
        p = Path(__file__).resolve().parents[3] / settings.uploads_dir
    p.mkdir(parents=True, exist_ok=True)
    return p


def _is_admin(learner: Learner | None, token: str | None) -> bool:
    if settings.admin_token and token == settings.admin_token:
        return True
    return learner is not None and learner.role == "admin"


def _can_curate(learner: Learner | None, token: str | None) -> bool:
    """Who can add catalog entries: any elevated role, or the admin token."""
    if _is_admin(learner, token):
        return True
    return learner is not None and learner.role in (
        "trainer", "manager", "bu_head", "hr", "hr_lead",
    )


def _cert_out(cert: Certification, earned_count: int = 0) -> CertificationOut:
    out = CertificationOut.model_validate(cert, from_attributes=True)
    out.earned_count = earned_count
    return out


# --------------------------------------------------------------------------- #
# Catalog                                                                     #
# --------------------------------------------------------------------------- #


@router.get("", response_model=list[CertificationOut])
def list_catalog(q: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Certification)
    if q:
        like = f"%{q}%"
        query = query.filter(Certification.name.ilike(like) | Certification.provider.ilike(like))
    counts = dict(
        db.query(EarnedCertificate.certification_id, func.count())
        .filter(EarnedCertificate.certification_id.isnot(None))
        .group_by(EarnedCertificate.certification_id)
    )
    # Newest first. Alphabetical meant a certification added this morning
    # landed between two from last year, where nobody would look for it.
    return [
        _cert_out(c, counts.get(c.id, 0))
        for c in query.order_by(Certification.id.desc()).all()
    ]


@router.post("", response_model=CertificationOut, status_code=201)
def add_to_catalog(
    payload: CertificationCreate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_curate(viewer, x_admin_token):
        raise HTTPException(
            status_code=403,
            detail="Only trainers, Skill Leads, managers or admins can add catalog entries.",
        )
    name = payload.name.strip()
    if db.query(Certification).filter(Certification.name.ilike(name)).first():
        raise HTTPException(status_code=409, detail=f"'{name}' is already in the catalog.")
    cert = Certification(
        name=name,
        provider=payload.provider.strip(),
        description=payload.description.strip(),
        url=payload.url.strip(),
        level=payload.level if payload.level in ("beginner", "intermediate", "advanced") else "beginner",
        tags=payload.tags,
        client_required=payload.client_required,
        client_name=payload.client_name.strip(),
        validity_months=max(0, payload.validity_months),
        added_by_id=viewer.id if viewer else None,
        added_by_name=(viewer.name or viewer.handle) if viewer else "admin",
    )
    db.add(cert)
    db.commit()
    db.refresh(cert)
    return _cert_out(cert)


@router.delete("/{cert_id}", status_code=204)
def remove_from_catalog(
    cert_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _is_admin(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only admins can remove catalog entries.")
    cert = db.get(Certification, cert_id)
    if cert:
        db.delete(cert)
        db.commit()


# --------------------------------------------------------------------------- #
# Team suggestions                                                            #
# --------------------------------------------------------------------------- #


def _suggestion_out(db: Session, s: CertificationSuggestion, cert: Certification) -> SuggestionOut:
    team = db.get(Team, s.team_id) if s.team_id else None
    target = db.get(Learner, s.target_id) if s.target_id else None
    return SuggestionOut(
        id=s.id,
        certification=_cert_out(cert),
        team_id=team.id if team else None,
        team_name=team.name if team else "",
        target_id=target.id if target else None,
        target_handle=(target.name or target.handle) if target else "",
        suggested_by_name=s.suggested_by_name,
        note=s.note,
        created_at=s.created_at,
    )


@router.get("/suggestions", response_model=list[SuggestionOut])
def list_suggestions(
    learner_id: int | None = None,
    team_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Team suggestions for every team the viewer belongs to / oversees, plus
    personal recommendations addressed to the viewer."""
    team_ids: set[int] = set()
    viewer = db.get(Learner, learner_id) if learner_id else None
    if team_id:
        team_ids.add(team_id)
    elif viewer:
        if viewer.team_id:
            team_ids.add(viewer.team_id)
        for t in db.query(Team).filter(
            (Team.lead_id == viewer.id) | (Team.manager_id == viewer.id)
        ):
            team_ids.add(t.id)

    filters = []
    if team_ids:
        filters.append(CertificationSuggestion.team_id.in_(team_ids))
    if viewer:
        filters.append(CertificationSuggestion.target_id == viewer.id)
    if not filters:
        return []

    rows = (
        db.query(CertificationSuggestion, Certification)
        .join(Certification, CertificationSuggestion.certification_id == Certification.id)
        .filter(sa_or(*filters))
        .order_by(CertificationSuggestion.id.desc())
        .all()
    )
    return [_suggestion_out(db, s, c) for s, c in rows]


def _oversees(db: Session, viewer: Learner | None, token: str | None, team_id: int | None) -> bool:
    """Can `viewer` suggest for this team: its lead/manager, HR, or admin."""
    if _is_admin(viewer, token) or (viewer is not None and viewer.role in ("hr", "hr_lead")):
        return True
    if viewer is None or team_id is None:
        return False
    team = db.get(Team, team_id)
    return team is not None and viewer.id in (team.lead_id, team.manager_id)


@router.post("/{cert_id}/suggest")
def suggest(
    cert_id: int,
    payload: SuggestRequest,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Suggest a certification to a whole team (`team_id`) and/or recommend it
    to specific people (`target_ids`)."""
    cert = db.get(Certification, cert_id)
    if not cert:
        raise HTTPException(status_code=404, detail="Certification not found")
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    suggester = (viewer.name or viewer.handle) if viewer else "admin"
    note = payload.note.strip()
    created, skipped = [], []

    if payload.team_id:
        team = db.get(Team, payload.team_id)
        if not team:
            raise HTTPException(status_code=404, detail="Team not found")
        if not _oversees(db, viewer, x_admin_token, team.id):
            raise HTTPException(
                status_code=403,
                detail="Only the team's Skill Lead, its manager, HR or an admin can suggest certifications.",
            )
        if db.query(CertificationSuggestion).filter_by(
            certification_id=cert.id, team_id=team.id
        ).first():
            skipped.append({"target": team.name, "reason": "already suggested for this team"})
        else:
            db.add(CertificationSuggestion(
                certification_id=cert.id, team_id=team.id,
                suggested_by_id=viewer.id if viewer else None,
                suggested_by_name=suggester, note=note,
            ))
            created.append(team.name)
            member_ids = [m.id for m in db.query(Learner).filter(Learner.team_id == team.id)]
            notify(
                db, member_ids,
                kind="cert_suggested",
                title=f"Certification suggested for your team: {cert.name}",
                body=note or f"Suggested by {suggester}",
                link="/certifications",
                exclude=viewer.id if viewer else None,
            )

    for target_id in payload.target_ids:
        target = db.get(Learner, target_id)
        if not target:
            skipped.append({"target": str(target_id), "reason": "no such learner"})
            continue
        if not _oversees(db, viewer, x_admin_token, target.team_id):
            skipped.append({"target": target.handle, "reason": "you don't oversee this person's team"})
            continue
        if db.query(CertificationSuggestion).filter_by(
            certification_id=cert.id, target_id=target.id
        ).first():
            skipped.append({"target": target.handle, "reason": "already recommended to them"})
            continue
        db.add(CertificationSuggestion(
            certification_id=cert.id, target_id=target.id,
            suggested_by_id=viewer.id if viewer else None,
            suggested_by_name=suggester, note=note,
        ))
        created.append(target.handle)
        notify(
            db, [target.id],
            kind="cert_suggested",
            title=f"{suggester} recommends you: {cert.name}",
            body=note or "A certification picked for you.",
            link="/certifications",
        )

    if not payload.team_id and not payload.target_ids:
        raise HTTPException(status_code=400, detail="Give a team_id and/or target_ids.")
    db.commit()
    return {"created": created, "skipped": skipped}


@router.delete("/suggestions/{suggestion_id}", status_code=204)
def withdraw_suggestion(
    suggestion_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    s = db.get(CertificationSuggestion, suggestion_id)
    if not s:
        return
    viewer = db.get(Learner, learner_id) if learner_id else None
    is_suggester = viewer is not None and s.suggested_by_id == viewer.id
    if not (is_suggester or _is_admin(viewer, x_admin_token)):
        raise HTTPException(status_code=403, detail="Only the suggester or an admin can withdraw this.")
    db.delete(s)
    db.commit()


# --------------------------------------------------------------------------- #
# Earned wall                                                                 #
# --------------------------------------------------------------------------- #


@router.post("/upload")
async def upload_certificate(file: UploadFile = File(...)):
    """Upload a certificate document (pdf/png/jpg/webp). Returns the stored name."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Allowed types: {', '.join(sorted(ALLOWED_EXT))}")
    stored = f"cert-{uuid.uuid4().hex}{ext}"
    dest = _uploads_dir() / stored
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="File too large (max 10 MB).")
            out.write(chunk)
    return {"file_name": stored, "file_original_name": file.filename}


def _earned_out(
    e: EarnedCertificate,
    learner: Learner,
    team_name: str,
    catalog: Certification | None = None,
) -> EarnedOut:
    return EarnedOut(
        id=e.id,
        learner_id=learner.id,
        handle=learner.handle,
        name=learner.name,
        team_name=team_name,
        certification_id=e.certification_id,
        title=e.title,
        issuer=e.issuer,
        obtained_on=e.obtained_on,
        expires_on=e.expires_on,
        credential_url=e.credential_url,
        client_required=bool(catalog and catalog.client_required),
        client_name=(catalog.client_name if catalog else ""),
        has_file=bool(e.file_name),
        created_at=e.created_at,
    )


@router.get("/feed", response_model=list[EarnedOut])
def feed(limit: int = 30, team_id: int | None = None, db: Session = Depends(get_db)):
    """Recently shared certificates — newest first, optionally one team's.

    Ordered by the day it was earned, not by the row id. Those agree while
    people add their own certificates one at a time, and stop agreeing the
    moment the Coursera sync imports a back catalogue: it writes in whatever
    order the provider returns, so "recently earned" was showing 2026 above
    2025 above 2026. A certificate with no date sits at the bottom rather than
    jumping the queue.
    """
    q = (
        db.query(EarnedCertificate, Learner, Team)
        .join(Learner, EarnedCertificate.learner_id == Learner.id)
        .outerjoin(Team, Learner.team_id == Team.id)
        .order_by(EarnedCertificate.obtained_on.desc().nullslast(),
                  EarnedCertificate.id.desc())
    )
    if team_id:
        q = q.filter(Learner.team_id == team_id)
    rows = q.limit(max(1, min(limit, 100))).all()
    catalog = {c.id: c for c in db.query(Certification).all()}
    return [
        _earned_out(e, l, t.name if t else "", catalog.get(e.certification_id))
        for e, l, t in rows
    ]


@router.post("/earned", response_model=EarnedOut, status_code=201)
def share_certificate(payload: EarnedCreate, db: Session = Depends(get_db)):
    learner = db.get(Learner, payload.learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    cert = db.get(Certification, payload.certification_id) if payload.certification_id else None
    title = payload.title.strip() or (cert.name if cert else "")
    if not title:
        raise HTTPException(status_code=400, detail="Give the certificate a title (or pick one from the catalog).")
    # A catalog entry that states its validity fills in the expiry when the
    # sharer didn't — otherwise a renewable certification silently reads as
    # "never expires" and drops out of the reminder sweep.
    expires_on = payload.expires_on
    if expires_on is None and cert:
        expires_on = expiry_from_validity(payload.obtained_on, cert.validity_months)

    e = EarnedCertificate(
        learner_id=learner.id,
        certification_id=cert.id if cert else None,
        title=title,
        issuer=payload.issuer.strip() or (cert.provider if cert else ""),
        obtained_on=payload.obtained_on,
        expires_on=expires_on,
        credential_url=payload.credential_url.strip(),
        file_name=payload.file_name,
        file_original_name=payload.file_original_name,
    )
    db.add(e)

    # Celebrate with the team: members + the Skill Lead and manager. The
    # manager gets their own line, in their language and pointing at their
    # team, so they are left out of the broadcast rather than told twice.
    if learner.team_id:
        team_obj = db.get(Team, learner.team_id)
        manager = manager_alerts.manager_of(db, learner)
        audience = [m.id for m in db.query(Learner).filter(Learner.team_id == learner.team_id)]
        if team_obj:
            audience += [team_obj.lead_id or 0, team_obj.manager_id or 0]
        if manager:
            audience = [i for i in audience if i != manager.id]
            manager_alerts.tell_manager(
                db, learner, kind="cert_earned", key="team.cert", title=title, issuer=e.issuer or "—",
            )
        notify(
            db,
            audience,
            kind="cert_earned",
            title=f"{learner.name or learner.handle} earned {title}",
            body=e.issuer,
            link="/certifications",
            exclude=learner.id,
        )
    db.commit()
    db.refresh(e)
    team = db.get(Team, learner.team_id) if learner.team_id else None
    return _earned_out(e, learner, team.name if team else "", cert)


@router.get("/earned/{earned_id}/file")
def certificate_file(earned_id: int, view: bool = True, db: Session = Depends(get_db)):
    e = db.get(EarnedCertificate, earned_id)
    if not e or not e.file_name:
        raise HTTPException(status_code=404, detail="No file for this certificate")
    path = _uploads_dir() / e.file_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(
        path,
        filename=e.file_original_name or e.file_name,
        content_disposition_type="inline" if view else "attachment",
    )


@router.delete("/earned/{earned_id}", status_code=204)
def delete_earned(
    earned_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    e = db.get(EarnedCertificate, earned_id)
    if not e:
        return
    viewer = db.get(Learner, learner_id) if learner_id else None
    is_owner = viewer is not None and e.learner_id == viewer.id
    if not (is_owner or _is_admin(viewer, x_admin_token)):
        raise HTTPException(status_code=403, detail="Only the owner or an admin can remove this.")
    if e.file_name:
        (_uploads_dir() / e.file_name).unlink(missing_ok=True)
    db.delete(e)
    db.commit()


# --------------------------------------------------------------------------- #
# Follow-up: what is lapsing, and who is missing a required certificate       #
# --------------------------------------------------------------------------- #
# Both read the viewer's oversight scope — a manager their team, a BU head their
# BU, an HRBP their perimeter, L&D everyone. The earlier renewal panel filtered
# the 30 most recently *shared* certificates in the browser, so a certificate
# shared months ago dropped out exactly when it started to matter, and it
# ignored scope entirely.

# How far back a lapsed certificate stays on the list. Long enough to chase a
# renewal; short enough that a certificate nobody means to renew stops nagging.
LAPSED_WINDOW_DAYS = 90


def _team_names(db: Session, learners: list[Learner]) -> dict[int, str]:
    ids = {l.team_id for l in learners if l.team_id}
    if not ids:
        return {}
    return {t.id: t.name for t in db.query(Team).filter(Team.id.in_(ids)).all()}


@router.get("/expiring")
def expiring(
    learner_id: int | None = None,
    days: int = 60,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Certificates in the viewer's scope that lapse within `days`, or lapsed
    recently. Client-required ones first, then soonest first."""
    viewer = db.get(Learner, learner_id) if learner_id else None
    scope = oversight_scope(db, viewer, x_admin_token)
    today = dt.date.today()
    horizon = today + dt.timedelta(days=max(1, min(days, 365)))
    floor = today - dt.timedelta(days=LAPSED_WINDOW_DAYS)

    q = (
        db.query(EarnedCertificate, Learner)
        .join(Learner, EarnedCertificate.learner_id == Learner.id)
        .filter(
            EarnedCertificate.expires_on.isnot(None),
            EarnedCertificate.expires_on <= horizon,
            EarnedCertificate.expires_on >= floor,
        )
    )
    if not scope.org_wide:
        q = q.filter(Learner.id.in_(scope.learner_ids or {0}))
    rows = q.all()

    catalog = {c.id: c for c in db.query(Certification).all()}
    teams = _team_names(db, [l for _, l in rows])
    items = [
        _earned_out(e, l, teams.get(l.team_id, ""), catalog.get(e.certification_id))
        for e, l in rows
    ]
    items.sort(key=lambda i: (not i.client_required, i.expires_on))
    return {"scope": scope.label, "org_wide": scope.org_wide, "items": items}


@router.get("/compliance")
def compliance(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """For each client-required certification: who holds it, whose has
    lapsed or is about to, and who is expected to hold it but does not.

    "Expected" comes from suggestions — a certification suggested to a team or
    to a person is one those people are meant to hold. Without a suggestion
    there is no audience, and the view says so rather than declaring the
    whole organisation non-compliant.
    """
    viewer = db.get(Learner, learner_id) if learner_id else None
    scope = oversight_scope(db, viewer, x_admin_token)
    if not scope.org_wide and len(scope.learner_ids or ()) <= 1:
        raise HTTPException(
            status_code=403,
            detail="Compliance follow-up is for managers, BU heads, HR and L&D.",
        )
    today = dt.date.today()
    soon = today + dt.timedelta(days=60)

    required = (
        db.query(Certification)
        .filter(Certification.client_required.is_(True))
        .order_by(Certification.client_name, Certification.name)
        .all()
    )
    out = []
    for cert in required:
        held = (
            db.query(EarnedCertificate, Learner)
            .join(Learner, EarnedCertificate.learner_id == Learner.id)
            .filter(EarnedCertificate.certification_id == cert.id)
            .all()
        )
        # One person may have shared the same certification twice (a renewal):
        # the latest expiry is the one that counts.
        best: dict[int, tuple[EarnedCertificate, Learner]] = {}
        for e, l in held:
            if not scope.allows(l.id):
                continue
            current = best.get(l.id)
            if current is None or (e.expires_on or dt.date.max) > (current[0].expires_on or dt.date.max):
                best[l.id] = (e, l)

        suggestions = db.query(CertificationSuggestion).filter_by(certification_id=cert.id).all()
        team_ids = [s.team_id for s in suggestions if s.team_id]
        expected_ids = {s.target_id for s in suggestions if s.target_id}
        if team_ids:
            expected_ids |= {
                row[0]
                for row in db.query(Learner.id).filter(Learner.team_id.in_(team_ids)).all()
            }
        expected_ids = {i for i in expected_ids if scope.allows(i)}

        def person(l: Learner, e: EarnedCertificate | None = None) -> dict:
            return {
                "learner_id": l.id,
                "handle": l.handle,
                "name": l.name or l.handle,
                "bu": l.bu,
                "expires_on": e.expires_on.isoformat() if e and e.expires_on else None,
            }

        valid, expiring_soon, lapsed = [], [], []
        for e, l in best.values():
            if e.expires_on and e.expires_on < today:
                lapsed.append(person(l, e))
            elif e.expires_on and e.expires_on <= soon:
                expiring_soon.append(person(l, e))
            else:
                valid.append(person(l, e))
        # Lapsed holders are already listed as lapsed; "missing" is for the
        # people who never had it, so nobody appears twice.
        on_record = {p["learner_id"] for p in valid + expiring_soon + lapsed}
        missing_ids = expected_ids - on_record
        missing = [
            person(l)
            for l in db.query(Learner).filter(Learner.id.in_(missing_ids or {0})).order_by(Learner.name).all()
        ]
        out.append({
            "certification_id": cert.id,
            "name": cert.name,
            "provider": cert.provider,
            "client_name": cert.client_name,
            "validity_months": cert.validity_months,
            "audience_defined": bool(suggestions),
            "expected": len(expected_ids),
            "valid": sorted(valid, key=lambda p: p["name"]),
            "expiring": sorted(expiring_soon, key=lambda p: p["expires_on"] or ""),
            "lapsed": sorted(lapsed, key=lambda p: p["expires_on"] or ""),
            "missing": missing,
        })
    return {"scope": scope.label, "org_wide": scope.org_wide, "certifications": out}
