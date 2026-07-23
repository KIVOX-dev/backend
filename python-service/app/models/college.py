"""
Skillovate V2 — College Model
Represents educational institutions registered on the platform.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text,
    Index,
)
from sqlalchemy.orm import relationship

from app.database import Base


class College(Base):
    __tablename__ = "colleges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, unique=True, index=True)
    short_code = Column(String(20), nullable=False, unique=True)
    location = Column(String(255), default="")
    address = Column(Text, default="")
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(20), nullable=True)
    website = Column(String(255), nullable=True)
    logo_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Relationships ────────────────────────────
    departments = relationship("Department", back_populates="college", cascade="all, delete-orphan")
    users = relationship("User", back_populates="college")
    assessments = relationship("Assessment", back_populates="college")
    job_postings = relationship("JobPosting", back_populates="college")
    placements = relationship("Placement", back_populates="college")

    __table_args__ = (
        Index("ix_colleges_active", "is_active"),
        Index("ix_colleges_short_code", "short_code"),
    )

    def __repr__(self):
        return f"<College(id={self.id}, name='{self.name}', code='{self.short_code}')>"


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    college_id = Column(Integer, nullable=False)
    name = Column(String(100), nullable=False)
    code = Column(String(20), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Relationships ────────────────────────────
    college = relationship("College", back_populates="departments")

    __table_args__ = (
        # ForeignKey defined here for proper constraint naming
        {"schema": None},
    )

    def __repr__(self):
        return f"<Department(id={self.id}, name='{self.name}', college_id={self.college_id})>"


# Fix foreign key after table definition to avoid circular import issues
from sqlalchemy import ForeignKey
Department.__table__.c.college_id.append_foreign_key(
    ForeignKey("colleges.id", ondelete="CASCADE")
)

# Add unique constraint: no duplicate department names within a college
from sqlalchemy import UniqueConstraint
Department.__table__.append_constraint(
    UniqueConstraint("college_id", "code", name="uq_department_college_code")
)
