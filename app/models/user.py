"""
Skillovate V2 — User Models
Core user table + role-specific profile tables (Student, Faculty, Recruiter).
Uses table-per-type pattern: shared fields in `users`, role-specific fields in profile tables.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey,
    Index, UniqueConstraint, CheckConstraint, JSON
)
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    """
    Central user account for all roles.
    Role-specific data lives in StudentProfile, FacultyProfile, RecruiterProfile.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    role = Column(
        String(20),
        nullable=False,
        default="student",
    )
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="SET NULL"), nullable=True)
    department = Column(String(100), nullable=True)
    phone = Column(String(20), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    is_email_verified = Column(Boolean, default=False, nullable=False)
    status = Column(String(20), default="approved", nullable=False)  # pending, approved, rejected
    
    # ── Persistence & UI State ───────────────────
    preferences = Column(JSON, default={}, nullable=False)
    saved_data = Column(JSON, default={}, nullable=False)
    last_session = Column(JSON, default={}, nullable=False)

    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Relationships ────────────────────────────
    college = relationship("College", back_populates="users")
    student_profile = relationship("StudentProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    faculty_profile = relationship("FacultyProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    recruiter_profile = relationship("RecruiterProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")
    achievements = relationship("Achievement", back_populates="user", cascade="all, delete-orphan")
    activity_logs = relationship("ActivityLog", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "role IN ('student', 'faculty', 'college_admin', 'recruiter', 'super_admin')",
            name="ck_users_role",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_users_status",
        ),
        Index("ix_users_role_college", "role", "college_id"),
        Index("ix_users_college_dept", "college_id", "department"),
    )

    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}', role='{self.role}')>"

    @property
    def company_name(self) -> str | None:
        if self.recruiter_profile:
            return self.recruiter_profile.company_name
        return None

    @property
    def student_id(self) -> str | None:
        if self.student_profile:
            return self.student_profile.student_id
        return None


class StudentProfile(Base):
    """Extended profile data for students."""
    __tablename__ = "student_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    student_id = Column(String(50), nullable=True)  # Roll number / registration number
    year = Column(Integer, nullable=True)
    semester = Column(Integer, nullable=True)
    cgpa = Column(Float, nullable=True)
    skills = Column(Text, nullable=True)  # Comma-separated or stored as text
    resume_url = Column(String(500), nullable=True)
    linkedin_url = Column(String(500), nullable=True)
    github_url = Column(String(500), nullable=True)

    # ── Stats (denormalized for dashboard performance) ──
    tests_completed = Column(Integer, default=0, nullable=False)
    avg_accuracy = Column(Float, default=0.0, nullable=False)
    interviews_completed = Column(Integer, default=0, nullable=False)
    streak = Column(Integer, default=0, nullable=False)
    national_rank = Column(Integer, nullable=True)
    placement_status = Column(String(20), default="unplaced", nullable=False)  # unplaced, placed

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Relationships ────────────────────────────
    user = relationship("User", back_populates="student_profile")

    __table_args__ = (
        # student_id unique within a college (via user's college_id)
        Index("ix_student_profiles_student_id", "student_id"),
        CheckConstraint(
            "placement_status IN ('unplaced', 'placed')",
            name="ck_student_profiles_placement_status",
        ),
    )

    def __repr__(self):
        return f"<StudentProfile(user_id={self.user_id}, student_id='{self.student_id}')>"


class FacultyProfile(Base):
    """Extended profile data for faculty members."""
    __tablename__ = "faculty_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    employee_id = Column(String(50), nullable=True)
    designation = Column(String(100), nullable=True)
    specialization = Column(String(255), nullable=True)
    experience_years = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Relationships ────────────────────────────
    user = relationship("User", back_populates="faculty_profile")

    def __repr__(self):
        return f"<FacultyProfile(user_id={self.user_id}, employee_id='{self.employee_id}')>"


class RecruiterProfile(Base):
    """Extended profile data for recruiters."""
    __tablename__ = "recruiter_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    company_name = Column(String(255), nullable=False)
    company_website = Column(String(500), nullable=True)
    company_logo_url = Column(String(500), nullable=True)
    designation = Column(String(100), nullable=True)
    industry = Column(String(100), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Relationships ────────────────────────────
    user = relationship("User", back_populates="recruiter_profile")
    job_postings = relationship("JobPosting", back_populates="recruiter", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<RecruiterProfile(user_id={self.user_id}, company='{self.company_name}')>"


class RefreshToken(Base):
    """Stores active refresh tokens for token rotation."""
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    jti = Column(String(36), nullable=False, unique=True, index=True)  # JWT ID
    token_hash = Column(String(255), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    # ── Relationships ────────────────────────────
    user = relationship("User", back_populates="refresh_tokens")

    __table_args__ = (
        Index("ix_refresh_tokens_user_active", "user_id", "is_revoked"),
    )

    def __repr__(self):
        return f"<RefreshToken(user_id={self.user_id}, jti='{self.jti}', revoked={self.is_revoked})>"
