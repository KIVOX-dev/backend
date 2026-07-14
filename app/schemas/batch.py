from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class BatchStudentInput(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    student_id: Optional[str] = None
    roll: Optional[str] = None
    department: Optional[str] = None
    year: Optional[int] = None
    password: str = "student123"


class BatchCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    batch_code: Optional[str] = None
    department: str
    year: str
    students: list[BatchStudentInput] = []


class BatchStatusRequest(BaseModel):
    status: str


class BatchResponse(BaseModel):
    id: int
    name: str
    batch_code: str
    college_id: int
    faculty_id: int
    department: str
    year: str
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
