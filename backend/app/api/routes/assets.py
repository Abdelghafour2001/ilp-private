from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.notifier import notify
from app.db.session import get_db
from app.models import Asset, Learner , Team
from app.schemas.asset import AssetCreate, AssetOut, AssetReviewIn, AssetSummary, AssetUpdate

def _is_admin_token(token: str | None) -> bool:
    return bool(settings.admin_token) and token == settings.admin_token


def _is_admin(learner: Learner | None, token: str | None) -> bool:
    return _is_admin_token(token) or (learner is not None and learner.role == "admin")


def _is_people_admin(learner: Learner | None, token: str | None) -> bool:
    return _is_admin(learner, token) or (
        learner is not None and learner.role in ("hr", "hr_lead")
    )


def _can_review_asset(db: Session, asset: Asset, viewer: Learner | None, token: str | None) -> bool:
    """HR/admin can review any asset. Otherwise, only the Skill Lead or
    manager of the AUTHOR's team can — not a manager of any other team.
    An author with no team can only be reviewed by HR/admin."""
    if _is_people_admin(viewer, token):
        return True
    if viewer is None or asset.learner_id is None:
        return False
    author = db.get(Learner, asset.learner_id)
    if not author or not author.team_id:
        return False
    team = db.get(Team, author.team_id)
    return team is not None and viewer.id in (team.lead_id, team.manager_id)

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("", response_model=list[AssetSummary])
def list_assets(
    kind: str | None = None,
    q: str | None = None,
    learner_id: int | None = None,
    pending_review: bool = False,
    db: Session = Depends(get_db),
):
    viewer = db.get(Learner, learner_id) if learner_id else None

    if pending_review:
        candidates = db.query(Asset).filter(Asset.status == "pending").order_by(Asset.id.desc()).all()
        return [a for a in candidates if _can_review_asset(db, a, viewer, None)]
    
    query = db.query(Asset)
    if kind:
        query = query.filter(Asset.kind == kind)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Asset.title.ilike(like), Asset.summary.ilike(like)))

    viewer = db.get(Learner, learner_id) if learner_id else None
    if not (viewer and viewer.role in ("hr", "hr_lead", "admin")):
        visibility = [Asset.status == "approved"]
        if viewer:
            visibility.append(Asset.learner_id == viewer.id)
        query = query.filter(or_(*visibility))    
    return query.order_by(Asset.id.desc()).all()


@router.post("", response_model=AssetOut, status_code=201)
def create_asset(payload: AssetCreate, db: Session = Depends(get_db)):
    author = payload.author
    if payload.learner_id:
        learner = db.get(Learner, payload.learner_id)
        if learner and not author:
            author = learner.handle
    asset = Asset(
        title=payload.title.strip(),
        kind=payload.kind,
        summary=payload.summary.strip(),
        body_md=payload.body_md,
        code=payload.code,
        link=payload.link,
        tags=payload.tags,
        author=(author or "anonymous").strip(),
        learner_id=payload.learner_id,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int, db: Session = Depends(get_db)):
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.delete("/{asset_id}", status_code=204)
def delete_asset(
    asset_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Deletable by the author (matching learner_id) or by an admin token."""
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    is_admin = settings.admin_token and x_admin_token == settings.admin_token
    is_author = asset.learner_id is not None and asset.learner_id == learner_id
    if not (is_admin or is_author):
        raise HTTPException(status_code=403, detail="Only the author or an admin can delete this.")

    db.delete(asset)
    db.commit()

@router.post("/{asset_id}/review", response_model=AssetOut)
def review_asset(
    asset_id: int,
    payload: AssetReviewIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    viewer = db.get(Learner, payload.learner_id)
    if not _can_review_asset(db, asset, viewer, x_admin_token):
        raise HTTPException(
            status_code=403,
            detail="Only the author's Skill Lead/manager, HR, or an admin can review this asset.",
        )

    asset.status = "approved" if payload.decision == "approve" else "rejected"
    asset.reviewed_by = (viewer.name or viewer.handle) if viewer else "admin"
    asset.review_note = payload.note.strip()
    db.commit()
    db.refresh(asset)

    if asset.learner_id:
        approved = asset.status == "approved"
        notify(
            db, [asset.learner_id],
            kind="asset_review",
            title=f"{'✅' if approved else '❌'} Your asset “{asset.title}” was {asset.status}",
            body=(payload.note.strip() or "No reason given.") if not approved else payload.note.strip()[:120],
            link=f"/assets/{asset.id}",
        )

    return asset    

@router.put("/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: int,
    payload: AssetUpdate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    is_admin = settings.admin_token and x_admin_token == settings.admin_token
    is_author = asset.learner_id is not None and asset.learner_id == payload.learner_id
    if not (is_admin or is_author):
        raise HTTPException(status_code=403, detail="Only the author or an admin can edit this.")

    # What a reviewer actually read. Changing any of it invalidates their
    # approval; tags and links are metadata and do not.
    MATERIAL = ("title", "kind", "summary", "body_md", "code")
    changed_material = any(
        getattr(payload, field) is not None
        and (getattr(payload, field) or "").strip() != (getattr(asset, field) or "")
        for field in MATERIAL
    )

    for field in ("title", "kind", "summary", "body_md", "code", "link", "tags"):
        value = getattr(payload, field)
        if value is not None:
            setattr(asset, field, value.strip() if isinstance(value, str) else value)

    # A corrected, resubmitted asset goes back into the review queue — and so
    # does an approved one whose substance changed. Otherwise "approved" means
    # "this text was approved at some point", and an author can get a thin
    # asset through and then replace its body with nobody seeing the new one.
    if asset.status == "rejected" or (asset.status == "approved" and changed_material):
        asset.status = "pending"
        asset.reviewed_by = None
        asset.review_note = None

    db.commit()
    db.refresh(asset)
    return asset