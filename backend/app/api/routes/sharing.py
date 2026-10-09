import logging
import shutil
import subprocess
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models import Learner, SharingSession
from app.schemas.sharing import SharingCreate, SharingOut, SharingSummary, SharingUpdate

router = APIRouter(prefix="/sharing", tags=["sharing"])
log = logging.getLogger(__name__)

ALLOWED_EXT = {".pptx", ".ppt", ".pdf", ".key"}
MAX_BYTES = 60 * 1024 * 1024  # 60 MB


def _uploads_dir() -> Path:
    p = Path(settings.uploads_dir)
    if not p.is_absolute():
        p = Path(__file__).resolve().parents[3] / settings.uploads_dir
    p.mkdir(parents=True, exist_ok=True)
    return p


def _author(db: Session, learner_id: int | None, author: str | None) -> str:
    if author:
        return author.strip()
    if learner_id:
        learner = db.get(Learner, learner_id)
        if learner:
            return learner.handle
    return "anonymous"


def _summary(s: SharingSession) -> SharingSummary:
    out = SharingSummary.model_validate(s)
    out.has_deck = bool(s.file_name)
    return out


@router.get("", response_model=list[SharingSummary])
def list_sessions(q: str | None = None, db: Session = Depends(get_db)):
    query = db.query(SharingSession)
    if q:
        like = f"%{q}%"
        query = query.filter(SharingSession.title.ilike(like))
    return [_summary(s) for s in query.order_by(SharingSession.id.desc()).all()]


@router.post("/upload")
async def upload_deck(file: UploadFile = File(...)):
    """Upload a slide deck (pptx/ppt/pdf/key). Returns the stored filename."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Allowed types: {', '.join(sorted(ALLOWED_EXT))}")

    stored = f"{uuid.uuid4().hex}{ext}"
    dest = _uploads_dir() / stored
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="File too large (max 60 MB).")
            out.write(chunk)

    converted = _to_pdf(dest)
    if converted:
        dest.unlink(missing_ok=True)
        return {
            "file_name": converted.name,
            "file_original_name": f"{Path(file.filename or 'deck').stem}.pdf",
        }
    return {"file_name": stored, "file_original_name": file.filename}


def _to_pdf(source: Path) -> Path | None:
    """Convert a slide deck to PDF when a converter is installed.

    Only a PDF previews in the browser; a .pptx can be downloaded and nothing
    more, which makes an archive of past talks much less useful than it looks.
    LibreOffice does the conversion when the image carries it — it is not a
    dependency, so this returns None and the original file stands.
    """
    if source.suffix.lower() not in {".pptx", ".ppt", ".key"}:
        return None
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    if not binary:
        return None
    try:
        subprocess.run(
            [binary, "--headless", "--convert-to", "pdf", "--outdir", str(source.parent), str(source)],
            check=True, capture_output=True, timeout=180,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        log.warning("deck conversion failed for %s: %s", source.name, exc)
        return None
    produced = source.with_suffix(".pdf")
    return produced if produced.exists() else None


@router.post("", response_model=SharingOut, status_code=201)
def create_session(payload: SharingCreate, db: Session = Depends(get_db)):
    s = SharingSession(
        title=payload.title.strip(),
        abstract=payload.abstract.strip(),
        body_md=payload.body_md,
        presenter=payload.presenter.strip(),
        session_date=payload.session_date,
        tags=payload.tags,
        file_name=payload.file_name,
        file_original_name=payload.file_original_name,
        recording_url=payload.recording_url,
        author=_author(db, payload.learner_id, payload.author),
        learner_id=payload.learner_id,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    out = SharingOut.model_validate(s)
    out.has_deck = bool(s.file_name)
    return out


@router.get("/{session_id}", response_model=SharingOut)
def get_session(session_id: int, db: Session = Depends(get_db)):
    s = db.get(SharingSession, session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    out = SharingOut.model_validate(s)
    out.has_deck = bool(s.file_name)
    return out


@router.get("/{session_id}/deck")
def download_deck(session_id: int, view: bool = False, db: Session = Depends(get_db)):
    """Serve the deck. `?view=1` serves it inline (for the in-app viewer);
    otherwise it downloads with the original filename."""
    s = db.get(SharingSession, session_id)
    if not s or not s.file_name:
        raise HTTPException(status_code=404, detail="No deck for this session")
    path = _uploads_dir() / s.file_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(
        path,
        filename=s.file_original_name or s.file_name,
        content_disposition_type="inline" if view else "attachment",
    )


@router.put("/{session_id}", response_model=SharingOut)
def update_session(
    session_id: int,
    payload: SharingUpdate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Correct an archived session, deck included.

    Same rule as deleting it: the person who posted it, or an admin. Replacing
    the deck is an edit like any other — a talk gets re-recorded and the slides
    get fixed, and the alternative was deleting the session and losing its URL.
    """
    session = db.get(SharingSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    is_admin = settings.admin_token and x_admin_token == settings.admin_token
    is_author = session.learner_id is not None and session.learner_id == payload.learner_id
    if not (is_admin or is_author):
        raise HTTPException(status_code=403, detail="Only the author or an admin can edit this.")

    old_file = session.file_name
    for field in ("title", "abstract", "body_md", "presenter", "session_date", "tags",
                  "file_name", "file_original_name", "recording_url"):
        value = getattr(payload, field)
        if value is not None:
            setattr(session, field, value.strip() if isinstance(value, str) else value)

    # A replaced deck leaves its file behind otherwise, and uploads are the one
    # thing here that grows without bound.
    if old_file and session.file_name != old_file:
        (_uploads_dir() / old_file).unlink(missing_ok=True)

    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=204)
def delete_session(
    session_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    s = db.get(SharingSession, session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    is_admin = settings.admin_token and x_admin_token == settings.admin_token
    is_author = s.learner_id is not None and s.learner_id == learner_id
    if not (is_admin or is_author):
        raise HTTPException(status_code=403, detail="Only the author or an admin can delete this.")
    if s.file_name:
        (_uploads_dir() / s.file_name).unlink(missing_ok=True)
    db.delete(s)
    db.commit()
