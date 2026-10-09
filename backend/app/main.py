import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.routes.admin import require_admin
from app.core.config import settings
from app.core.feature_middleware import FeatureMiddleware
from app.core.identity_middleware import IdentityMiddleware


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Skipped when the image entrypoint already printed the report before migrating.
    if not os.environ.get("STARTUP_DIAGNOSTICS_DONE"):
        if not logging.getLogger().handlers:
            logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
        from app.core.diagnostics import log_report

        log_report("api")
    yield


app = FastAPI(title=f"{settings.app_name} — learning platform", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# A switched-off module 404s before its router is ever reached. Added before
# IdentityMiddleware, so it runs *after* it: the learner_id it reads is the
# proven one, not the one the caller asked to be.
app.add_middleware(FeatureMiddleware)

# Outermost of the three: it must rewrite the query string before anything
# reads it, and it needs CORS to have already answered preflights.
app.add_middleware(IdentityMiddleware)

app.include_router(api_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok", "ai_enabled": settings.ai_enabled}


@app.get("/api/health/diagnostics", dependencies=[Depends(require_admin)])
def diagnostics():
    """Every dependency checked live (database, Redis, SMTP, AI, SSO...), for admins."""
    from app.core.diagnostics import FAIL, WARN, as_dicts, config_summary, run_checks

    results = run_checks("api")
    status = "fail" if any(r.status == FAIL for r in results) else "warn" if any(r.status == WARN for r in results) else "ok"
    return {"status": status, "config": config_summary(settings), "checks": as_dicts(results)}
