import logging

from fastapi import APIRouter, Depends

from app.config import get_settings
from app.db import timed_log
from app.groq_client import GroqError, groq_complete
from app.schemas.practice import ExplainItem, ExplainRequest, ExplainResponse, Explanation
from app.security import verify_service_token

logger = logging.getLogger("ai-service.practice")
router = APIRouter(prefix="/v1/practice", tags=["practice"], dependencies=[Depends(verify_service_token)])

SYSTEM_PROMPT = (
    "You are a patient tutor explaining multiple-choice practice questions to college students preparing "
    "for placement tests. For each question you are given the answer key's correct answer."
)


def _render(index: int, item: ExplainItem) -> str:
    lines = [f"Question {index}: {item.question}"]
    if item.data_presentation:
        lines.append(f"Data: {item.data_presentation}")
    lines.append("Options: " + " | ".join(f"{chr(65 + i)}) {opt}" for i, opt in enumerate(item.options)))
    lines.append(f"Answer key: {item.correct_answer}")
    return "\n".join(lines)


def _unavailable(count: int) -> ExplainResponse:
    return ExplainResponse(source="unavailable", explanations=[Explanation() for _ in range(count)])


@router.post("/explain", response_model=ExplainResponse)
async def explain(payload: ExplainRequest):
    settings = get_settings()
    count = len(payload.questions)
    if not settings.is_groq_configured:
        return _unavailable(count)

    user_prompt = (
        "Explain why the answer key's option is correct for each question below.\n"
        "- 2 to 4 short sentences, plain language, no markdown.\n"
        "- For calculations, show the working step by step with the actual numbers.\n"
        "- For code-output questions, trace the evaluation order.\n"
        "- Do not just restate the answer.\n"
        "- If, after checking carefully, you are confident the answer key is WRONG, set \"disputed\" to true, "
        "put the answer you believe is correct in \"suggested_answer\", and explain why.\n"
        'Return a raw JSON object: {"explanations": [{"n": <question number>, "explanation": "...", '
        '"disputed": false, "suggested_answer": null}]} with one entry per question.\n\n'
        + "\n\n".join(_render(i + 1, q) for i, q in enumerate(payload.questions))
    )

    async with timed_log("practice.explain") as detail:
        detail["count"] = count
        try:
            # Generous budget: gpt-oss models spend part of it on reasoning before the JSON.
            result = await groq_complete(SYSTEM_PROMPT, user_prompt, temperature=0.2, max_tokens=4096, json_response=True)
        except GroqError as exc:
            logger.error("Practice explanation failed: %s", exc)
            return _unavailable(count)

    raw = result.get("explanations", []) if isinstance(result, dict) else []
    by_number: dict[int, Explanation] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        try:
            n = int(entry.get("n"))
        except (TypeError, ValueError):
            continue
        text = str(entry.get("explanation") or "").strip()
        if not 1 <= n <= count or not text:
            continue
        suggested = entry.get("suggested_answer")
        by_number[n] = Explanation(
            text=text[:1200],
            disputed=bool(entry.get("disputed")),
            suggested_answer=str(suggested).strip()[:300] if suggested else None,
        )

    explanations = [by_number.get(i + 1, Explanation()) for i in range(count)]
    return ExplainResponse(source="ai" if by_number else "unavailable", explanations=explanations)
