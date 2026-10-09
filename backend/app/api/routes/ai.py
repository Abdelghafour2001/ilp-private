import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.ai import (
    generate_quiz,
    recommend_next,
    review_submission,
    stream_tutor_chat,
    tutor_hint,
)
from app.core.config import settings
from app.db.session import get_db
from app.labs import registry
from app.models import Learner, StepCompletion

router = APIRouter(prefix="/ai", tags=["ai"])


class TutorRequest(BaseModel):
    lab_id: str
    step_id: str
    submission: dict | None = None
    last_result: dict | None = None
    question: str | None = None


class ChatMessage(BaseModel):
    role: str
    content: str


class TutorChatRequest(BaseModel):
    lab_id: str
    step_id: str
    messages: list[ChatMessage] = []
    submission: dict | None = None
    last_result: dict | None = None
    hint_level: int = 1


class ReviewRequest(BaseModel):
    language: str
    code: str
    task: str
    dataset: str | None = None


class QuizRequest(BaseModel):
    lab_id: str | None = None
    topic: str | None = None
    n: int = 5


@router.get("/status")
def ai_status():
    return {
        "enabled": settings.ai_enabled,
        "provider": settings.resolved_provider,
        "model": settings.ai_model_name,
    }


@router.post("/tutor")
def tutor(payload: TutorRequest, db: Session = Depends(get_db)):
    if not settings.ai_enabled:
        raise HTTPException(status_code=400, detail="AI is not configured (set ANTHROPIC_API_KEY or run Ollama).")
    lab = registry.get_lab(db, payload.lab_id)
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    step = next((s for s in lab.steps if s.id == payload.step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    try:
        hint = tutor_hint(
            lab_title=lab.title,
            step_title=step.title,
            step_body=step.body_md,
            dataset=f"{lab.dataset.schema_name}.{lab.dataset.table}",
            submission=payload.submission,
            last_result=payload.last_result,
            question=payload.question,
        )
        return {"hint": hint}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/tutor/stream")
def tutor_stream(payload: TutorChatRequest, db: Session = Depends(get_db)):
    """Streaming, multi-turn tutor. Emits Server-Sent Events: each frame is
    `data: {"text": "..."}`, ending with `data: {"done": true}`; errors arrive as
    `data: {"error": "..."}`."""
    if not settings.ai_enabled:
        raise HTTPException(status_code=400, detail="AI is not configured (set ANTHROPIC_API_KEY or run Ollama).")
    lab = registry.get_lab(db, payload.lab_id)
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    step = next((s for s in lab.steps if s.id == payload.step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    def event_stream():
        try:
            chunks = stream_tutor_chat(
                lab_title=lab.title,
                step_title=step.title,
                step_body=step.body_md,
                dataset=f"{lab.dataset.schema_name}.{lab.dataset.table}",
                builder_mode=step.builder.mode,
                messages=[m.model_dump() for m in payload.messages],
                submission=payload.submission,
                last_result=payload.last_result,
                hint_level=payload.hint_level,
            )
            for chunk in chunks:
                yield f"data: {json.dumps({'text': chunk})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/review")
def review(payload: ReviewRequest):
    if not settings.ai_enabled:
        raise HTTPException(status_code=400, detail="AI is not configured (set ANTHROPIC_API_KEY or run Ollama).")
    if not payload.code.strip():
        raise HTTPException(status_code=400, detail="Nothing to review yet.")
    try:
        return review_submission(
            language=payload.language, code=payload.code, task=payload.task, dataset=payload.dataset
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/quiz")
def quiz(payload: QuizRequest, db: Session = Depends(get_db)):
    if not settings.ai_enabled:
        raise HTTPException(status_code=400, detail="AI is not configured (set ANTHROPIC_API_KEY or run Ollama).")
    topic = payload.topic
    context = ""
    if payload.lab_id:
        lab = registry.get_lab(db, payload.lab_id)
        if not lab:
            raise HTTPException(status_code=404, detail="Lab not found")
        topic = topic or lab.title
        context = "\n\n".join(
            f"## {s.title}\n{s.body_md}" for s in lab.steps if s.body_md
        )[:6000]
    if not topic:
        raise HTTPException(status_code=400, detail="Provide a topic or a lab_id.")
    try:
        return generate_quiz(topic=topic, context=context, n=max(3, min(10, payload.n)))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/recommend")
def recommend(learner_id: int | None = None, db: Session = Depends(get_db)):
    if not settings.ai_enabled:
        raise HTTPException(status_code=400, detail="AI is not configured (set ANTHROPIC_API_KEY or run Ollama).")

    completed_keys: list[str] = []
    if learner_id and db.get(Learner, learner_id):
        rows = db.query(StepCompletion).filter(StepCompletion.learner_id == learner_id).all()
        completed_keys = [f"{r.lab_id}:{r.step_id}" for r in rows]

    catalog = []
    for lab in registry.all_labs(db):
        step_ids = {s.id for s in lab.steps}
        done = {r.split(":", 1)[1] for r in completed_keys if r.startswith(f"{lab.id}:")}
        catalog.append(
            {
                "id": lab.id,
                "title": lab.title,
                "track": lab.track,
                "difficulty": lab.difficulty,
                "summary": lab.summary,
                "completed": bool(step_ids) and step_ids.issubset(done),
            }
        )
    try:
        return recommend_next(completed=completed_keys, catalog=catalog)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
