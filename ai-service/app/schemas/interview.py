from pydantic import BaseModel, Field


class GenerateQuestionsRequest(BaseModel):
    role: str = Field(min_length=1)
    company: str = "general"


class InterviewQuestion(BaseModel):
    id: int
    text: str
    time_limit_seconds: int = 60
    type: str
