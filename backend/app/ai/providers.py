"""Pluggable LLM backends so the AI features work with either a Claude API key
or a local Ollama model — no code changes, just config.

Two primitives the service layer needs:
  * complete_text  — free-form text answer (explanations, tutor hints)
  * complete_json  — a response validated against a Pydantic model (check suggestions)

Anthropic uses native structured outputs + adaptive thinking; Ollama uses its
JSON mode and we validate the result with the same Pydantic model.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import TypeVar

import anthropic
import httpx
from pydantic import BaseModel

from app.core.config import settings

T = TypeVar("T", bound=BaseModel)

# A chat turn: {"role": "user"|"assistant", "content": str}
Message = dict[str, str]


def _anthropic() -> anthropic.Anthropic:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _ollama_chat(system: str, user: str, *, json_mode: bool) -> str:
    payload: dict = {
        "model": settings.ollama_model,
        "stream": False,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if json_mode:
        payload["format"] = "json"
    try:
        resp = httpx.post(f"{settings.ollama_base_url}/api/chat", json=payload, timeout=180)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise RuntimeError(
            f"Could not reach Ollama at {settings.ollama_base_url}. Is it running "
            f"(`ollama serve`) and is the model pulled (`ollama pull {settings.ollama_model}`)? {exc}"
        ) from exc
    return resp.json()["message"]["content"]


def _azure_openai_chat(system: str, user: str, *, json_mode: bool, max_tokens: int) -> str:
    """Azure OpenAI chat completion.

    Azure addresses a *deployment*, not a model, and authenticates with an
    `api-key` header rather than a bearer token — so it needs its own call
    rather than the OpenAI client pointed elsewhere.
    """
    url = (
        f"{settings.azure_openai_endpoint.rstrip('/')}/openai/deployments/"
        f"{settings.azure_openai_deployment}/chat/completions"
        f"?api-version={settings.azure_openai_api_version}"
    )
    payload: dict = {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    r = httpx.post(
        url,
        json=payload,
        headers={"api-key": settings.azure_openai_api_key},
        timeout=120,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"] or ""


def _azure_openai_stream(
    system: str, messages: list[Message], *, max_tokens: int
) -> Iterator[str]:
    """Server-sent events from Azure OpenAI, yielded as plain text deltas."""
    url = (
        f"{settings.azure_openai_endpoint.rstrip('/')}/openai/deployments/"
        f"{settings.azure_openai_deployment}/chat/completions"
        f"?api-version={settings.azure_openai_api_version}"
    )
    payload = {
        "messages": [{"role": "system", "content": system}, *messages],
        "max_tokens": max_tokens,
        "stream": True,
    }
    with httpx.stream(
        "POST", url, json=payload,
        headers={"api-key": settings.azure_openai_api_key}, timeout=120,
    ) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line.startswith("data: "):
                continue
            body = line[6:]
            if body == "[DONE]":
                return
            choices = json.loads(body).get("choices") or []
            if choices:
                piece = choices[0].get("delta", {}).get("content")
                if piece:
                    yield piece


def complete_text(system: str, user: str, *, max_tokens: int = 1000) -> str:
    if settings.resolved_provider == "ollama":
        return _ollama_chat(system, user, json_mode=False).strip()
    if settings.resolved_provider == "azure_openai":
        return _azure_openai_chat(system, user, json_mode=False, max_tokens=max_tokens).strip()
    resp = _anthropic().messages.create(
        model=settings.ai_model,
        max_tokens=max_tokens,
        thinking={"type": "adaptive"},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def _ollama_stream(system: str, messages: list[Message]) -> Iterator[str]:
    payload = {
        "model": settings.ollama_model,
        "stream": True,
        "messages": [{"role": "system", "content": system}, *messages],
    }
    try:
        with httpx.stream(
            "POST", f"{settings.ollama_base_url}/api/chat", json=payload, timeout=180
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                data = json.loads(line)
                chunk = data.get("message", {}).get("content")
                if chunk:
                    yield chunk
    except httpx.HTTPError as exc:
        raise RuntimeError(
            f"Could not reach Ollama at {settings.ollama_base_url}. Is it running "
            f"(`ollama serve`) and is the model pulled (`ollama pull {settings.ollama_model}`)? {exc}"
        ) from exc


def stream_chat(system: str, messages: list[Message], *, max_tokens: int = 1200) -> Iterator[str]:
    """Stream an assistant reply over a multi-turn conversation, token by token."""
    if settings.resolved_provider == "ollama":
        yield from _ollama_stream(system, messages)
        return
    if settings.resolved_provider == "azure_openai":
        yield from _azure_openai_stream(system, messages, max_tokens=max_tokens)
        return
    with _anthropic().messages.stream(
        model=settings.ai_model,
        max_tokens=max_tokens,
        system=system,
        messages=messages,  # type: ignore[arg-type]
    ) as stream:
        yield from stream.text_stream


def complete_json(system: str, user: str, schema: type[T], *, max_tokens: int = 4000) -> T:
    if settings.resolved_provider == "ollama":
        guided = (
            f"{system}\n\nRespond with ONLY a JSON object matching this JSON schema "
            f"(no prose, no markdown):\n{json.dumps(schema.model_json_schema())}"
        )
        raw = _ollama_chat(guided, user, json_mode=True)
        return schema.model_validate_json(raw)
    if settings.resolved_provider == "azure_openai":
        guided = (
            f"{system}\n\nRespond with ONLY a JSON object matching this JSON schema "
            f"(no prose, no markdown):\n{json.dumps(schema.model_json_schema())}"
        )
        raw = _azure_openai_chat(guided, user, json_mode=True, max_tokens=max_tokens)
        return schema.model_validate_json(raw)
    resp = _anthropic().messages.parse(
        model=settings.ai_model,
        max_tokens=max_tokens,
        thinking={"type": "adaptive"},
        system=system,
        messages=[{"role": "user", "content": user}],
        output_format=schema,
    )
    return resp.parsed_output
