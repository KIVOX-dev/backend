import logging
import random

from fastapi import APIRouter, Depends

from app.config import get_settings
from app.db import timed_log
from app.groq_client import GroqError, groq_complete
from app.schemas.interview import GenerateQuestionsRequest, InterviewQuestion
from app.security import verify_service_token

logger = logging.getLogger("ai-service.interview")
router = APIRouter(prefix="/v1/interview", tags=["interview"], dependencies=[Depends(verify_service_token)])

# Ported verbatim from node-api's interview.service.js (itself ported from
# python-service's interviews.py#generate_questions) — only ever tagged
# "technical", matching both prior implementations exactly.
FALLBACK_QUESTION_POOL = [
    "What are the key differences between React and Angular?",
    "Explain the concept of closures in JavaScript.",
    "How would you optimize a slow-performing database query?",
    "Describe a time you had to resolve a conflict within your team.",
    "What is the difference between TCP and UDP?",
]


def _fallback_questions(company: str, role: str) -> list[InterviewQuestion]:
    pool = FALLBACK_QUESTION_POOL * 2
    random.shuffle(pool)
    return [
        InterviewQuestion(
            id=i + 1,
            text=f"[{company.upper()} - {role.upper()}] {q}",
            time_limit_seconds=60,
            type="technical",
        )
        for i, q in enumerate(pool)
    ]


@router.post("/generate-questions", response_model=list[InterviewQuestion])
async def generate_questions(payload: GenerateQuestionsRequest):
    settings = get_settings()

    if not settings.is_groq_configured:
        return _fallback_questions(payload.company, payload.role)

    system_prompt = f"You are an expert technical interviewer at {payload.company} hiring for a {payload.role} position."
    user_prompt = (
        "Generate exactly 10 interview questions for this specific role and company.\n"
        "Make them realistic, challenging, and a mix of technical (7) and behavioral (3) questions.\n"
        'Return the result as a raw JSON object with a single key "questions" containing a list of strings.'
    )

    async with timed_log("interview.generate_questions") as detail:
        detail["role"] = payload.role
        detail["company"] = payload.company
        try:
            result = await groq_complete(system_prompt, user_prompt, temperature=0.7, max_tokens=1024, json_response=True)
            questions = result.get("questions", []) if isinstance(result, dict) else []
            if len(questions) < 10:
                raise GroqError("LLM did not return enough questions")
        except GroqError as exc:
            logger.error("Interview question generation failed, falling back: %s", exc)
            return _fallback_questions(payload.company, payload.role)

    return [
        InterviewQuestion(id=i + 1, text=q, time_limit_seconds=60, type="technical" if i < 7 else "behavioral")
        for i, q in enumerate(questions[:10])
    ]
