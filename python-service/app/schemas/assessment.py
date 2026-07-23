from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class AssessmentCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    description: Optional[str] = None
    assessment_type: str = "mixed"
    duration_minutes: int = Field(default=30, ge=1)
    total_marks: int = Field(default=20, ge=1)
    pass_percentage: float = Field(default=40.0, ge=0, le=100)
    negative_marking: bool = False
    target_departments: Optional[str] = None
    target_years: Optional[str] = None
    difficulty: str = "medium"
    status: str = "active"
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None


class AssessmentUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    duration_minutes: Optional[int] = None
    total_marks: Optional[int] = None
    pass_percentage: Optional[float] = None
    negative_marking: Optional[bool] = None
    target_departments: Optional[str] = None
    target_years: Optional[str] = None
    difficulty: Optional[str] = None
    status: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None


class AssessmentResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    assessment_type: str
    college_id: int
    created_by: Optional[int] = None
    duration_minutes: int
    total_marks: int
    pass_percentage: float
    negative_marking: bool
    target_departments: Optional[str] = None
    target_years: Optional[str] = None
    difficulty: str
    status: str
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TestSubmitRequest(BaseModel):
    assessment_id: Optional[int] = None
    roll_no: Optional[str] = None
    score: int = 0
    max_score: int = Field(default=100, ge=1)
    percentage: Optional[float] = None
    time_taken_seconds: Optional[int] = None
    section_scores: Optional[str] = None
    weak_areas: Optional[str] = None


class AttemptResponse(BaseModel):
    id: int
    assessment_id: int
    student_id: int
    college_id: int
    score: Optional[int] = None
    max_score: Optional[int] = None
    percentage: Optional[float] = None
    time_taken_seconds: Optional[int] = None
    passed: Optional[bool] = None
    status: str
    completed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}
