import json
import logging

import httpx

from app.config import get_settings

logger = logging.getLogger("ai-service.openai")


class OpenAIError(Exception):
    """Raised when a configured OpenAI call fails outright (network error,
    non-2xx response, or unparseable JSON when jsonResponse was requested).
    Callers translate this into a 502 — distinct from "not configured",
    which routes check for themselves via settings.is_openai_configured
    before ever reaching this module."""


async def openai_complete(
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    json_response: bool = False,
) -> str | dict:
    settings = get_settings()
    body = {
        "model": settings.openai_model,
        "temperature": temperature,
        # OpenAI's current chat models take max_completion_tokens; the older
        # max_tokens is rejected by reasoning-style models.
        "max_completion_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if json_response:
        body["response_format"] = {"type": "json_object"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.openai_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        logger.error("OpenAI request failed: %s", exc)
        raise OpenAIError(str(exc)) from exc

    content = data["choices"][0]["message"]["content"] or ""
    if not json_response:
        return content
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        logger.error("OpenAI returned non-JSON content for a json_response request: %s", exc)
        raise OpenAIError(f"OpenAI returned invalid JSON: {exc}") from exc
