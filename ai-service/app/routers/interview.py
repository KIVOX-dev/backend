import logging
import random
import re

from fastapi import APIRouter, Depends

from app.config import get_settings
from app.db import timed_log
from app.openai_client import OpenAIError, openai_complete
from app.schemas.interview import (
    AnswerEvaluation,
    AnswerToEvaluate,
    EvaluateAnswersRequest,
    EvaluateAnswersResponse,
    GenerateMcqRequest,
    GenerateMcqResponse,
    GenerateQuestionsRequest,
    InterviewQuestion,
    McqQuestion,
)
from app.security import verify_service_token

logger = logging.getLogger("ai-service.interview")
router = APIRouter(prefix="/v1/interview", tags=["interview"], dependencies=[Depends(verify_service_token)])

# Per-round prompt focus, question type tag(s), and local fallback pool. The
# "technical" entry keeps the original 7 technical + 3 behavioral mix and the
# original fallback pool (ported from node-api's interview.service.js).
ROUNDS: dict[str, dict] = {
    "technical": {
        "label": "technical",
        "focus": "Make them realistic, challenging, and a mix of technical (7) and behavioral (3) questions.",
        "types": ["technical"] * 7 + ["behavioral"] * 3,
        "pool": [
            "What are the key differences between React and Angular?",
            "Explain the concept of closures in JavaScript.",
            "How would you optimize a slow-performing database query?",
            "Describe a time you had to resolve a conflict within your team.",
            "What is the difference between TCP and UDP?",
        ],
    },
    "system_design": {
        "label": "system design",
        "focus": (
            "Every question must be a system design question for this role: designing scalable services, APIs, "
            "data storage, caching, messaging, reliability and the trade-offs involved. No behavioral questions."
        ),
        "types": ["system design"] * 10,
        "pool": [
            "Design a URL shortening service that handles millions of requests per day.",
            "How would you design a notification system that sends email, SMS and push messages?",
            "Design a rate limiter for a public API.",
            "How would you design the backend for a real-time chat application?",
            "Design a file upload service that supports very large files and resumable uploads.",
        ],
    },
    "hr": {
        "label": "HR",
        "focus": (
            "This is the HR round. Ask only HR questions: background, why this company, strengths and weaknesses, "
            "career goals, handling feedback, relocation, notice period, salary expectations and culture fit. "
            "Do not ask any technical or coding questions."
        ),
        "types": ["hr"] * 10,
        "pool": [
            "Tell me about yourself and your background.",
            "Why do you want to join our company?",
            "What are your greatest strengths and one weakness you are working on?",
            "Where do you see yourself in five years?",
            "Are you comfortable relocating or working in shifts if required?",
        ],
    },
    "behavioral": {
        "label": "behavioral",
        "focus": (
            "Ask only behavioral questions meant to be answered with the STAR method: teamwork, conflict, failure, "
            "tight deadlines, taking ownership and learning quickly. Do not ask any technical questions."
        ),
        "types": ["behavioral"] * 10,
        "pool": [
            "Tell me about a time you handled a conflict within your team.",
            "Describe a situation where you missed a deadline. What did you do?",
            "Tell me about a time you took ownership of a problem nobody else wanted.",
            "Describe a time you had to learn something new very quickly.",
            "Tell me about a mistake you made and what you learned from it.",
        ],
    },
    "managerial": {
        "label": "managerial",
        "focus": (
            "This is the managerial round. Ask scenario questions on decision-making, prioritization, handling "
            "pressure, communicating with stakeholders, leading others and taking ownership. No coding questions."
        ),
        "types": ["managerial"] * 10,
        "pool": [
            "Your two most important tasks are both due today. How do you decide what to do first?",
            "How would you handle a teammate who is consistently missing their deadlines?",
            "A client asks for a change late in the project. How do you respond?",
            "Tell me about a decision you made with incomplete information.",
            "How do you keep stakeholders updated when a project is at risk?",
        ],
    },
    "aptitude": {
        "label": "problem solving",
        "focus": (
            "Ask problem-solving questions that can be answered verbally: logical reasoning puzzles, estimation "
            "questions and approach-based questions. Do not ask for code."
        ),
        "types": ["problem solving"] * 10,
        "pool": [
            "How many tennis balls could fit in this room? Walk me through your estimate.",
            "You have 8 identical balls and one is heavier. How do you find it with two weighings?",
            "How would you approach finding a bug that only happens once a week in production?",
            "Estimate how many cups of tea are sold in your city every day.",
            "You have a 3-litre and a 5-litre jug. How do you measure exactly 4 litres?",
        ],
    },
}


def _fallback_questions(company: str, role: str, round_id: str = "technical") -> list[InterviewQuestion]:
    spec = ROUNDS[round_id]
    pool = spec["pool"] * 2
    random.shuffle(pool)
    return [
        InterviewQuestion(
            id=i + 1,
            text=f"[{company.upper()} - {role.upper()}] {q}",
            time_limit_seconds=60,
            type=spec["types"][0] if round_id == "technical" else spec["types"][i],
        )
        for i, q in enumerate(pool)
    ]


@router.post("/generate-questions", response_model=list[InterviewQuestion])
async def generate_questions(payload: GenerateQuestionsRequest):
    settings = get_settings()
    spec = ROUNDS[payload.round]

    if not settings.is_openai_configured:
        return _fallback_questions(payload.company, payload.role, payload.round)

    system_prompt = (
        f"You are an expert interviewer at {payload.company} conducting the {spec['label']} round "
        f"for a {payload.role} position."
    )
    user_prompt = (
        "Generate exactly 10 interview questions for this specific role, company and round.\n"
        f"{spec['focus']}\n"
        'Return the result as a raw JSON object with a single key "questions" containing a list of objects, '
        'each with "question" (string) and "expected_answer" (2-3 sentences covering the key points a strong '
        "spoken answer should include)."
    )

    async with timed_log("interview.generate_questions") as detail:
        detail["role"] = payload.role
        detail["company"] = payload.company
        detail["round"] = payload.round
        try:
            # 2048, not 1024: gpt-oss models spend part of the budget on
            # reasoning before the JSON, and at 1024 the list was sometimes cut
            # off mid-array — silently falling back to the canned pool.
            result = await openai_complete(system_prompt, user_prompt, temperature=0.7, max_tokens=2048, json_response=True)
            raw = result.get("questions", []) if isinstance(result, dict) else []
            # Accept plain strings too, in case the model ignores the object shape.
            questions = [
                (str(q.get("question", "")).strip(), str(q.get("expected_answer", "")).strip())
                if isinstance(q, dict)
                else (str(q).strip(), "")
                for q in raw
            ]
            questions = [q for q in questions if q[0]]
            if len(questions) < 10:
                raise OpenAIError("LLM did not return enough questions")
        except OpenAIError as exc:
            logger.error("Interview question generation failed, falling back: %s", exc)
            return _fallback_questions(payload.company, payload.role, payload.round)

    return [
        InterviewQuestion(id=i + 1, text=q, time_limit_seconds=60, type=spec["types"][i], expected_answer=expected)
        for i, (q, expected) in enumerate(questions[:10])
    ]


_STOPWORDS = {"the", "and", "that", "this", "with", "for", "you", "your", "are", "was", "have", "from", "they", "will", "can", "what", "when", "how", "its", "which", "their", "about", "would", "should", "could", "into", "than", "then", "also"}


def _keywords(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#]+", text.lower()) if len(w) > 3 and w not in _STOPWORDS}


def _heuristic_score(item: AnswerToEvaluate) -> AnswerEvaluation:
    """Fallback grader: overlap with the expected answer, else with the question."""
    words = len(item.answer.split())
    if words == 0:
        return AnswerEvaluation(question_id=item.question_id, score=0, feedback="No answer was given.")
    reference = _keywords(item.expected_answer) or _keywords(item.question)
    coverage = len(reference & _keywords(item.answer)) / len(reference) if reference else 0.0
    length_factor = min(words / 40, 1.0)
    # With a model answer, coverage dominates; without one it can only be a rough guide.
    weight = 0.8 if item.expected_answer else 0.5
    score = round(10 * (weight * min(coverage * 1.5, 1.0) + (1 - weight) * length_factor))
    if item.expected_answer and coverage < 0.3:
        feedback = "Your answer missed most of the key points expected."
    elif words < 25:
        feedback = "Good start, but add more detail and an example."
    else:
        feedback = "Covered the main points; keep answers structured."
    return AnswerEvaluation(question_id=item.question_id, score=max(0, min(10, score)), feedback=feedback)


@router.post("/evaluate", response_model=EvaluateAnswersResponse)
async def evaluate_answers(payload: EvaluateAnswersRequest):
    """Round 2 scoring: grades each spoken answer against the question's expected answer."""
    settings = get_settings()
    heuristic = EvaluateAnswersResponse(source="heuristic", results=[_heuristic_score(a) for a in payload.answers])
    answered = [a for a in payload.answers if a.answer.strip()]
    if not settings.is_openai_configured or not answered:
        return heuristic

    system_prompt = (
        f"You are a strict but fair interviewer grading spoken interview answers for a {payload.role} position. "
        "The answers are speech-to-text transcripts, so ignore minor transcription errors and filler words."
    )
    items = [
        {"question_id": a.question_id, "question": a.question, "expected_answer": a.expected_answer, "answer": a.answer}
        for a in answered
    ]
    user_prompt = (
        "Grade each answer from 0 to 10 by how well it covers the key points of the expected answer "
        "(or, when expected_answer is empty, how correct, relevant and well structured it is). "
        "Give a score of 0 for an irrelevant answer.\n"
        f"Items: {items}\n"
        'Return a raw JSON object {"results": [{"question_id": int, "score": int, "feedback": "one short sentence"}]}.'
    )
    async with timed_log("interview.evaluate") as detail:
        detail["answers"] = len(answered)
        try:
            result = await openai_complete(system_prompt, user_prompt, temperature=0.2, max_tokens=2048, json_response=True)
            graded: dict[int, AnswerEvaluation] = {}
            for r in result.get("results", []) if isinstance(result, dict) else []:
                try:
                    graded[int(r["question_id"])] = AnswerEvaluation(
                        question_id=int(r["question_id"]),
                        score=max(0, min(10, round(float(r["score"])))),
                        feedback=str(r.get("feedback", "")).strip()[:300],
                    )
                except (KeyError, TypeError, ValueError):
                    continue
            if len(graded) < len(answered):
                raise OpenAIError("LLM did not grade every answer")
        except OpenAIError as exc:
            logger.error("Answer evaluation failed, using heuristic: %s", exc)
            return heuristic

    results = [graded.get(a.question_id) or _heuristic_score(a) for a in payload.answers]
    return EvaluateAnswersResponse(source="ai", results=results)


def _valid_mcqs(raw: list, limit: int) -> list[McqQuestion]:
    """Keeps only well-formed items: 4 distinct options, answer among them."""
    valid: list[McqQuestion] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question", "")).strip()
        options = [str(o).strip() for o in item.get("options", []) if str(o).strip()]
        answer = str(item.get("correct_answer", "")).strip()
        # Accept a letter answer ("B") by mapping it onto the option list.
        if len(answer) == 1 and answer.upper() in "ABCD" and len(options) == 4 and answer not in options:
            answer = options["ABCD".index(answer.upper())]
        key = question.lower()
        if not question or key in seen or len(options) != 4 or len(set(options)) != 4 or answer not in options:
            continue
        seen.add(key)
        valid.append(
            McqQuestion(
                id=len(valid) + 1,
                section=str(item.get("section", "")).strip() or "General",
                question=question,
                options=options,
                correct_answer=answer,
            )
        )
        if len(valid) == limit:
            break
    return valid


@router.post("/generate-mcq", response_model=GenerateMcqResponse)
async def generate_mcq(payload: GenerateMcqRequest):
    """Round 1 of the mock interview: a written test for this role at this company."""
    settings = get_settings()
    if not settings.is_openai_configured:
        return GenerateMcqResponse(source="unavailable", questions=[])

    aptitude = round(payload.count * 0.6)
    technical = payload.count - aptitude
    system_prompt = (
        f"You write the campus online assessment used by {payload.company} to hire a {payload.role}. "
        "You know that company's written-test pattern and difficulty."
    )
    user_prompt = (
        f"Generate exactly {payload.count} multiple-choice questions:\n"
        f"- {aptitude} aptitude questions split across the sections {payload.company}'s test actually uses "
        "(for example Quantitative, Logical Reasoning, Verbal Ability, Data Interpretation, Pseudo-code), "
        f"at {payload.company}'s typical difficulty.\n"
        f"- {technical} technical questions on the core skills a {payload.role} is tested on, in the section \"Technical\".\n"
        "Every question must be answerable without a calculator in under 90 seconds and have one clearly correct option.\n"
        'Return a raw JSON object {"questions": [...]}; each item has "section" (string), "question" (string), '
        '"options" (exactly 4 distinct strings) and "correct_answer" (exactly equal to one of the options). '
        "No markdown, no text outside the JSON."
    )

    async with timed_log("interview.generate_mcq") as detail:
        detail["role"] = payload.role
        detail["company"] = payload.company
        try:
            result = await openai_complete(
                system_prompt,
                user_prompt,
                temperature=0.6,
                max_tokens=max(2048, payload.count * 240),
                json_response=True,
            )
            raw = result.get("questions", []) if isinstance(result, dict) else []
            questions = _valid_mcqs(raw, payload.count)
            # Too few usable items reads as a broken test, not a short one.
            if len(questions) < max(5, payload.count * 2 // 3):
                raise OpenAIError(f"only {len(questions)} valid MCQs of {payload.count}")
        except OpenAIError as exc:
            logger.error("Interview MCQ generation failed, caller will fall back: %s", exc)
            return GenerateMcqResponse(source="unavailable", questions=[])

    # Grouped by section, in the order the model introduced them, like a real
    # sectioned test (Technical last, since the prompt lists it last).
    order = {s: i for i, s in enumerate(dict.fromkeys(q.section for q in questions))}
    questions.sort(key=lambda q: (q.section == "Technical", order[q.section]))
    for i, q in enumerate(questions):
        q.id = i + 1
    return GenerateMcqResponse(source="ai", questions=questions)
