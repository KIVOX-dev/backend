"""
Skillovate V2 — College Pydantic Schemas
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class CollegeCreateRequest(BaseModel):
    name: str = Field(min_length=3, max_length=255)
    short_code: str = Field(min_length=2, max_length=20)
    location: Optional[str] = ""
    address: Optional[str] = ""
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    departments: list[dict] = []  # [{"name": "CSE", "code": "CSE"}]


class CollegeUpdateRequest(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    is_active: Optional[bool] = None


class CollegeResponse(BaseModel):
    id: int
    name: str
    short_code: str
    location: str
    address: str
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DepartmentResponse(BaseModel):
    id: int
    name: str
    code: str
    is_active: bool
    college_id: int

    model_config = {"from_attributes": True}
