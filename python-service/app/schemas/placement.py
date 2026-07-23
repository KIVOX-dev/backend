from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PlacementCreateRequest(BaseModel):
    student_id: Optional[int] = None
    company_name: str
    role: str
    salary_lpa: float = Field(ge=0)
    work_type: str = "onsite"
    mode: str = "campus"
    location: Optional[str] = None
    proof_url: Optional[str] = None


class PlacementVerifyRequest(BaseModel):
    verification_status: str = "verified"


class PlacementResponse(BaseModel):
    id: int
    student_id: int
    college_id: int
    company_name: str
    role: str
    salary_lpa: float
    work_type: str
    mode: str
    location: Optional[str] = None
    offer_date: Optional[datetime] = None
    status: str
    proof_url: Optional[str] = None
    verified_by: Optional[int] = None
    verification_status: str
    verified_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class JobPostingCreateRequest(BaseModel):
    college_id: int = 1  # Defaulting for now
    title: str
    description: Optional[str] = None
    company_name: str
    location: Optional[str] = None
    job_type: str = "full_time"
    salary_min_lpa: Optional[float] = None
    salary_max_lpa: Optional[float] = None
    required_skills: Optional[str] = None
    eligible_departments: Optional[str] = None
    eligible_years: Optional[str] = None
    min_cgpa: Optional[float] = None
    application_deadline: Optional[datetime] = None

class JobPostingResponse(JobPostingCreateRequest):
    id: int
    recruiter_id: int
    status: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class JobApplicationResponse(BaseModel):
    id: int
    job_posting_id: int
    student_id: int
    status: str
    applied_at: datetime
    updated_at: datetime
    notes: Optional[str] = None
    interview_scheduled_at: Optional[datetime] = None
    
    # Nested info we might want
    student_name: Optional[str] = None
    student_email: Optional[str] = None
    job_title: Optional[str] = None

    model_config = {"from_attributes": True}
