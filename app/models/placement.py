"""
Skillovate V2 — Placement Models
Job postings, applications, and confirmed placements.
"""
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey,
    Index, CheckConstraint,
)
from sqlalchemy.orm import relationship
from app.database import Base


class JobPosting(Base):
    """Recruiter job listings targeted at specific colleges."""
    __tablename__ = "job_postings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    recruiter_id = Column(Integer, ForeignKey("recruiter_profiles.id", ondelete="CASCADE"), nullable=False)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    company_name = Column(String(255), nullable=False)
    location = Column(String(255), nullable=True)
    job_type = Column(String(20), default="full_time", nullable=False)
    salary_min_lpa = Column(Float, nullable=True)
    salary_max_lpa = Column(Float, nullable=True)
    required_skills = Column(Text, nullable=True)
    eligible_departments = Column(Text, nullable=True)
    eligible_years = Column(String(50), nullable=True)
    min_cgpa = Column(Float, nullable=True)
    application_deadline = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), default="active", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    recruiter = relationship("RecruiterProfile", back_populates="job_postings")
    college = relationship("College", back_populates="job_postings")
    applications = relationship("JobApplication", back_populates="job_posting", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("job_type IN ('full_time', 'internship', 'contract', 'part_time')", name="ck_jp_type"),
        CheckConstraint("status IN ('draft', 'active', 'closed', 'filled')", name="ck_jp_status"),
        Index("ix_jp_college_status", "college_id", "status"),
        Index("ix_jp_recruiter", "recruiter_id"),
    )


class JobApplication(Base):
    """Student application to a job posting."""
    __tablename__ = "job_applications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_posting_id = Column(Integer, ForeignKey("job_postings.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), default="applied", nullable=False)
    applied_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    notes = Column(Text, nullable=True)
    interview_scheduled_at = Column(DateTime(timezone=True), nullable=True)

    job_posting = relationship("JobPosting", back_populates="applications")
    student = relationship("User", foreign_keys=[student_id])

    __table_args__ = (
        CheckConstraint(
            "status IN ('applied', 'shortlisted', 'interview', 'selected', 'rejected', 'withdrawn')",
            name="ck_ja_status",
        ),
        Index("ix_ja_student_status", "student_id", "status"),
        Index("ix_ja_job", "job_posting_id"),
    )


class Placement(Base):
    """Confirmed placement records."""
    __tablename__ = "placements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False)
    company_name = Column(String(255), nullable=False)
    role = Column(String(255), nullable=False)
    salary_lpa = Column(Float, nullable=False)
    work_type = Column(String(20), default="onsite", nullable=False)
    mode = Column(String(20), default="campus", nullable=False)
    location = Column(String(255), nullable=True)
    offer_date = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    status = Column(String(20), default="placed", nullable=False)
    proof_url = Column(String(500), nullable=True)
    verified_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verification_status = Column(String(20), default="pending", nullable=False)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    student = relationship("User", foreign_keys=[student_id])
    college = relationship("College", back_populates="placements")
    verifier = relationship("User", foreign_keys=[verified_by])

    __table_args__ = (
        CheckConstraint("work_type IN ('onsite', 'remote', 'hybrid')", name="ck_pl_work_type"),
        CheckConstraint("mode IN ('campus', 'off_campus')", name="ck_pl_mode"),
        CheckConstraint("status IN ('applying', 'placed', 'rejected')", name="ck_pl_status"),
        CheckConstraint("verification_status IN ('pending', 'verified', 'rejected')", name="ck_pl_verification"),
        Index("ix_pl_student", "student_id"),
        Index("ix_pl_college_status", "college_id", "status"),
        Index("ix_pl_college_salary", "college_id", "salary_lpa"),
    )
