import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import get_settings
from app.db import timed_log
from app.groq_client import GroqError, groq_complete
from app.schemas.assessment import (
    AssessmentQuestion,
    GenerateAssessmentQuestionsRequest,
    GenerateAssessmentQuestionsResponse,
)
from app.security import verify_service_token

logger = logging.getLogger("ai-service.assessment")
router = APIRouter(prefix="/v1/assessment", tags=["assessment"], dependencies=[Depends(verify_service_token)])

# Ported verbatim from node-api's test.service.js (itself ported from
# python-service's assessments.py#generate_assessment_questions) — a single
# placeholder question, not a full set, matching both prior implementations
# exactly, regardless of how many were actually requested.
def _question_gen_system_prompt(count: int) -> str:
    return f"""You are an expert curriculum designer. Generate exactly {count}
multiple-choice questions as a raw JSON object: {{"questions": [...]}}. Each item must have
"question" (string), "options" (array of exactly 4 strings), and "correct_answer" (string,
must match one of the options). No markdown, no text outside the JSON."""


def _fallback_question(payload: GenerateAssessmentQuestionsRequest) -> GenerateAssessmentQuestionsResponse:
    return GenerateAssessmentQuestionsResponse(
        questions=[
            AssessmentQuestion(
                question=f"Sample {payload.difficulty} {payload.type} question for {payload.title}",
                options=["A", "B", "C", "D"],
                correct_answer="A",
            )
        ]
    )


@router.post("/generate-questions", response_model=GenerateAssessmentQuestionsResponse)
async def generate_questions(payload: GenerateAssessmentQuestionsRequest):
    settings = get_settings()
    if not settings.is_groq_configured:
        return _fallback_question(payload)

    user_prompt = f'Title: "{payload.title}"\nType: {payload.type}\nDifficulty: {payload.difficulty}'

    async with timed_log("assessment.generate_questions") as detail:
        detail["title"] = payload.title
        try:
            result = await groq_complete(
                _question_gen_system_prompt(payload.count),
                user_prompt,
                temperature=0.7,
                # ~200 tokens/question is a safe estimate for a 4-option MCQ
                # + correct_answer; 2048 was tuned for the original fixed
                # 10-question default and would truncate a larger `count`.
                max_tokens=max(2048, payload.count * 220),
                json_response=True,
            )
        except GroqError as exc:
            logger.error("Assessment question generation failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to generate questions: {exc}"
            ) from exc

    return GenerateAssessmentQuestionsResponse(questions=result.get("questions", []) if isinstance(result, dict) else [])
