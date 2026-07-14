"""
Skillovate V2 — Auth Pydantic Schemas
Request/Response models for authentication endpoints.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator
import re


class RegisterRequest(BaseModel):
    """User registration request."""
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=2, max_length=255)
    role: str = Field(default="student")
    college_id: Optional[int] = None
    department: Optional[str] = None

    # Student-specific
    student_id: Optional[str] = None
    year: Optional[int] = None

    # Recruiter-specific
    company_name: Optional[str] = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        allowed = {"student", "faculty", "college_admin", "recruiter"}
        if v not in allowed:
            raise ValueError(f"Role must be one of: {', '.join(allowed)}")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        if not re.search(r"[A-Za-z]", v):
            raise ValueError("Password must contain at least one letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one digit")
        return v


class LoginRequest(BaseModel):
    """User login request."""
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    """JWT token response."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds
    user: "UserBriefResponse"


class RefreshTokenRequest(BaseModel):
    """Refresh token request."""
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    """Change password request."""
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v):
        if not re.search(r"[A-Za-z]", v):
            raise ValueError("Password must contain at least one letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one digit")
        return v


class ForgotPasswordRequest(BaseModel):
    """- request."""
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Reset password with token."""
    token: str
    new_password: str = Field(min_length=6, max_length=128)


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    company_name: Optional[str] = None
    department: Optional[str] = None
    avatar_url: Optional[str] = None


class UserBriefResponse(BaseModel):
    """Brief user info included in auth responses."""
    id: int
    email: str
    name: str
    role: str
    college_id: Optional[int] = None
    department: Optional[str] = None
    avatar_url: Optional[str] = None
    company_name: Optional[str] = None
    student_id: Optional[str] = None

    model_config = {"from_attributes": True}


# Update forward reference
TokenResponse.model_rebuild()
