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
