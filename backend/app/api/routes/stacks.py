from fastapi import APIRouter, HTTPException

from app.stacks import get_stack, list_stacks, public_stack, stack_summary

router = APIRouter(prefix="/stacks", tags=["stacks"])


@router.get("")
def list_all():
    return [stack_summary(s) for s in list_stacks()]


@router.get("/{stack_id}")
def get_one(stack_id: str):
    recipe = get_stack(stack_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Stack not found")
    return public_stack(recipe)
