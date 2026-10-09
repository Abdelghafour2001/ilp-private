"""Record who edits content — powers the owners/editors column in HR analytics."""

from sqlalchemy.orm import Session

from app.models import ContentEditor, Learner


def track_editor(db: Session, entity_type: str, entity_id: int, editor: Learner | None) -> None:
    """Upsert an editor row (caller commits with the rest of its transaction)."""
    if editor is None:
        return
    row = (
        db.query(ContentEditor)
        .filter_by(entity_type=entity_type, entity_id=entity_id, learner_id=editor.id)
        .first()
    )
    if row:
        row.edits += 1
        row.name = editor.name or editor.handle
    else:
        db.add(ContentEditor(
            entity_type=entity_type,
            entity_id=entity_id,
            learner_id=editor.id,
            name=editor.name or editor.handle,
        ))
