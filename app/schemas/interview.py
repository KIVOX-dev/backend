from datetime import datetime
from typing import Optional, Union
import json

from pydantic import BaseModel, Field, field_validator


class InterviewResponseInput(BaseModel):
    question_id: Optional[int] = None
    question_text: Optional[str] = None
    answer_text: Optional[str] = None
    score: Optional[int] = Field(default=None, ge=0)
    rating: Optional[int] = Field(default=None, ge=1, le=10)
    feedback: Optional[str] = None
    time_taken_seconds: Optional[int] = None


class InterviewSubmitRequest(BaseModel):
    role: str
    category: str = "technical"
    overall_rating: Optional[float] = None
    strengths: Optional[Union[list[str], str]] = None
    improvements: Optional[Union[list[str], str]] = None
    duration_seconds: Optional[int] = None
    responses: list[InterviewResponseInput] = []

    @field_validator("strengths", "improvements", mode="before")
    @classmethod
    def coerce_to_json_str(cls, v):
        """Store lists as JSON strings in DB."""
        if isinstance(v, list):
            return json.dumps(v)
        return v


class InterviewAttemptResponse(BaseModel):
    id: int
    student_id: int
    college_id: int
    role: str
    category: str
    overall_rating: Optional[float] = None
    strengths: Optional[list[str]] = None
    improvements: Optional[list[str]] = None
    duration_seconds: Optional[int] = None
    attempt_number: int
    status: str
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}

    @field_validator("strengths", "improvements", mode="before")
    @classmethod
    def parse_json_list(cls, v):
        """Parse JSON strings back to lists for the response."""
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                return [v]
        return v
