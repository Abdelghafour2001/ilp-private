"""The switchboard: which modules this deployment runs, and for whom.

Two surfaces, deliberately different:

* `GET /features/mine` — public to anyone signed in, returns a flat map the UI
  uses to hide what this person does not have. No secrets in it: it says what
  they can already see by looking at their own sidebar.

* `/admin/switchboard/*` — the hidden half. Platform admins only, and kept out
  of the OpenAPI schema with `include_in_schema=False`, so it does not appear
  in /docs for every signed-in developer to find. That is concealment, not
  security: the admin check below is what actually guards it, and it is
  enforced on every route rather than on the router, so a new endpoint added
  here cannot inherit "open" by forgetting a dependency.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import features as registry
from app.core.feature_middleware import forget_feature_cache
from app.core.rbac import ROLES, is_platform_admin
from app.db.session import get_db
from app.models import BusinessUnit, FeatureFlag, Learner

router = APIRouter(tags=["features"])


def _viewer(db: Session, learner_id: int | None) -> Learner | None:
    return db.get(Learner, learner_id) if learner_id else None


def _admin(db: Session, learner_id: int | None, token: str | None) -> Learner | None:
    actor = _viewer(db, learner_id)
    if not is_platform_admin(actor, token):
        # The same answer a missing route gives. An admin-only surface that
        # says "forbidden" has confirmed it exists.
        raise HTTPException(status_code=404, detail="Not Found")
    return actor


# --------------------------------------------------------------------------- #
# what the signed-in person gets                                              #
# --------------------------------------------------------------------------- #


@router.get("/features/mine")
def my_features(learner_id: int | None = None, db: Session = Depends(get_db)):
    """The feature map for this viewer. Anonymous callers get the defaults."""
    return {"features": registry.enabled_for(db, _viewer(db, learner_id))}


# --------------------------------------------------------------------------- #
# the switchboard                                                             #
# --------------------------------------------------------------------------- #


class FlagIn(BaseModel):
    key: str
    enabled: bool = True
    # Empty = everyone. Both lists narrow; neither grants.
    roles: list[str] = Field(default_factory=list)
    bus: list[str] = Field(default_factory=list)
    note: str = ""
    learner_id: int | None = None


@router.get("/admin/switchboard", include_in_schema=False)
def switchboard(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Every switch, its current setting, and what turning it off removes."""
    _admin(db, learner_id, x_admin_token)
    rows = {f.key: f for f in db.query(FeatureFlag).all()}
    return {
        "features": [
            {
                "key": key,
                "label": label,
                "effect": effect,
                "enabled": rows[key].enabled if key in rows else True,
                "roles": rows[key].roles if key in rows else [],
                "bus": rows[key].bus if key in rows else [],
                "note": rows[key].note if key in rows else "",
                "updated_by": rows[key].updated_by if key in rows else "",
                "updated_at": rows[key].updated_at.isoformat()
                if key in rows and rows[key].updated_at else "",
                # No row means nobody has touched it: on, by default, forever.
                "configured": key in rows,
            }
            for key, (label, effect) in registry.FEATURES.items()
        ],
        "roles": list(ROLES),
        "bus": [b.name for b in db.query(BusinessUnit).filter(BusinessUnit.archived.is_(False))
                .order_by(BusinessUnit.position).all()],
    }


@router.put("/admin/switchboard", include_in_schema=False)
def set_switch(
    payload: FlagIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Set one switch. Creating and updating are the same act, so one verb."""
    actor = _admin(db, payload.learner_id, x_admin_token)
    if payload.key not in registry.FEATURES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown feature '{payload.key}'. Known: {', '.join(registry.FEATURES)}.",
        )
    unknown_roles = [r for r in payload.roles if r not in ROLES]
    if unknown_roles:
        raise HTTPException(status_code=400, detail=f"Unknown role(s): {', '.join(unknown_roles)}.")

    flag = db.query(FeatureFlag).filter(FeatureFlag.key == payload.key).first()
    if not flag:
        flag = FeatureFlag(key=payload.key)
        db.add(flag)
    flag.enabled = payload.enabled
    flag.roles = payload.roles
    flag.bus = payload.bus
    flag.note = payload.note[:300]
    flag.updated_by = (actor.name or actor.handle) if actor else "admin token"
    db.commit()
    db.refresh(flag)
    forget_feature_cache()
    return {
        "key": flag.key,
        "enabled": flag.enabled,
        "roles": flag.roles,
        "bus": flag.bus,
        "note": flag.note,
        "updated_by": flag.updated_by,
    }


@router.delete("/admin/switchboard/{key}", include_in_schema=False)
def clear_switch(
    key: str,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Forget a switch entirely — the feature returns to on for everyone.

    Distinct from setting it enabled: no row means nobody has an opinion, which
    is what a fresh deployment looks like.
    """
    _admin(db, learner_id, x_admin_token)
    deleted = db.query(FeatureFlag).filter(FeatureFlag.key == key).delete()
    db.commit()
    forget_feature_cache()
    return {"key": key, "cleared": bool(deleted)}
