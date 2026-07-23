"""
Skillovate V2 — Achievement & Activity Log Models
"""
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey,
    Index, UniqueConstraint, CheckConstraint,
)
from sqlalchemy.orm import relationship
from app.database import Base


class Achievement(Base):
    """Auto-generated student achievements and badges."""
    __tablename__ = "achievements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False)
    achievement_type = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    source_module = Column(String(20), nullable=False)
    reference_id = Column(Integer, nullable=True)
    metric_value = Column(Float, nullable=True)
    auto_generated = Column(Boolean, default=True, nullable=False)
    achieved_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="achievements")

    __table_args__ = (
        CheckConstraint(
            "source_module IN ('test', 'interview', 'placement', 'system')",
            name="ck_ach_source",
        ),
        UniqueConstraint("user_id", "achievement_type", "reference_id", name="uq_achievement_unique"),
        Index("ix_ach_user", "user_id", "achieved_at"),
        Index("ix_ach_college_type", "college_id", "achievement_type"),
    )


class ActivityLog(Base):
    """Audit trail for all significant platform actions."""
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action_type = Column(String(50), nullable=False)
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), default="success", nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="activity_logs")

    __table_args__ = (
        CheckConstraint("status IN ('success', 'failure', 'denied')", name="ck_al_status"),
        Index("ix_al_college_time", "college_id", "created_at"),
        Index("ix_al_action_time", "action_type", "created_at"),
        Index("ix_al_user", "user_id"),
    )


class Batch(Base):
    """Faculty-managed student groups/batches."""
    __tablename__ = "batches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    batch_code = Column(String(50), nullable=False, unique=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False)
    faculty_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    department = Column(String(100), nullable=False)
    year = Column(String(10), nullable=False)
    status = Column(String(20), default="active", nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    faculty = relationship("User", foreign_keys=[faculty_id])
    students = relationship("BatchStudent", back_populates="batch", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("status IN ('active', 'archived')", name="ck_batch_status"),
        Index("ix_batch_college", "college_id"),
        Index("ix_batch_faculty", "faculty_id"),
    )


class BatchStudent(Base):
    """Many-to-many: students enrolled in batches."""
    __tablename__ = "batch_students"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(Integer, ForeignKey("batches.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    enrolled_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    status = Column(String(20), default="active", nullable=False)

    batch = relationship("Batch", back_populates="students")
    student = relationship("User", foreign_keys=[student_id])

    __table_args__ = (
        UniqueConstraint("batch_id", "student_id", name="uq_batch_student"),
        CheckConstraint("status IN ('active', 'removed')", name="ck_bs_status"),
    )
