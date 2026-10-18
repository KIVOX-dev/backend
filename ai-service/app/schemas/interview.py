from typing import Literal

from pydantic import BaseModel, Field

InterviewRound = Literal["technical", "system_design", "hr", "behavioral", "managerial", "aptitude"]


class GenerateQuestionsRequest(BaseModel):
    role: str = Field(min_length=1)
    company: str = "general"
    round: InterviewRound = "technical"


class InterviewQuestion(BaseModel):
    id: int
    text: str
    time_limit_seconds: int = 60
    type: str
    # What a strong answer covers; used only to score the spoken answer. Empty
    # for the canned fallback pool, which has no model answers.
    expected_answer: str = ""


class AnswerToEvaluate(BaseModel):
    question_id: int
    question: str
    expected_answer: str = ""
    answer: str = ""


class EvaluateAnswersRequest(BaseModel):
    role: str = "general"
    answers: list[AnswerToEvaluate] = Field(min_length=1, max_length=20)


class AnswerEvaluation(BaseModel):
    question_id: int
    score: int = Field(ge=0, le=10)
    feedback: str


class EvaluateAnswersResponse(BaseModel):
    # "ai" when the LLM graded against the expected answers; "heuristic" when
    # it couldn't and keyword overlap / answer length was used instead.
    source: Literal["ai", "heuristic"]
    results: list[AnswerEvaluation]


class GenerateMcqRequest(BaseModel):
    role: str = Field(min_length=1)
    company: str = "general"
    count: int = Field(default=20, ge=5, le=30)


class McqQuestion(BaseModel):
    id: int
    section: str
    question: str
    options: list[str]
    correct_answer: str


class GenerateMcqResponse(BaseModel):
    # "ai" when the LLM produced the set; "unavailable" when it couldn't
    # (Groq not configured, errored, or returned too few valid questions) —
    # the caller then falls back to its own company question banks.
    source: Literal["ai", "unavailable"]
    questions: list[McqQuestion]
