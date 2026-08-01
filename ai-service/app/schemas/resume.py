from typing import Any

from pydantic import BaseModel


class AnalyzeRequest(BaseModel):
    resume: dict[str, Any]


class MatchJdRequest(BaseModel):
    resume: dict[str, Any]
    jd_text: str


class AiSuggestRequest(BaseModel):
    action: str
    section: str | None = None
    content: str | None = None
    jd_text: str | None = None
    resume: dict[str, Any] | None = None


class AiSuggestResponse(BaseModel):
    result: str | dict[str, Any]


class ParseResumeRequest(BaseModel):
    text: str


class ImproveResumeRequest(BaseModel):
    objective: str = ""
    education: str = ""
    skills: str = ""
    experience: str = ""


class ImproveResumeResponse(BaseModel):
    objective: str
    education: str
    skills: str
    experience: str
    message: str | None = None
