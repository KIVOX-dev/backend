"""
Skillovate V2 — Interview Models
Mock interview question banks, attempts, and per-question responses.
"""
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey,
    Index, UniqueConstraint, CheckConstraint,
)
from sqlalchemy.orm import relationship
from app.database import Base


class InterviewQuestionBank(Base):
    """Role-specific interview question sets."""
    __tablename__ = "interview_question_banks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False)
    category = Column(String(30), nullable=False, default="tech")
    description = Column(Text, nullable=True)
    difficulty = Column(String(20), default="medium", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    questions = relationship("InterviewQuestion", back_populates="bank", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        CheckConstraint("category IN ('tech', 'hr', 'commerce', 'custom')", name="ck_iqb_category"),
        CheckConstraint("difficulty IN ('easy', 'medium', 'hard')", name="ck_iqb_difficulty"),
        Index("ix_iqb_role_category", "role", "category"),
    )


class InterviewQuestion(Base):
    """Individual interview questions within a bank."""
    __tablename__ = "interview_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bank_id = Column(Integer, ForeignKey("interview_question_banks.id", ondelete="CASCADE"), nullable=False)
    question_text = Column(Text, nullable=False)
    expected_answer = Column(Text, nullable=True)
    evaluation_criteria = Column(Text, nullable=True)
    position = Column(Integer, nullable=False)

    bank = relationship("InterviewQuestionBank", back_populates="questions")
    responses = relationship("InterviewResponse", back_populates="question")

    __table_args__ = (
        UniqueConstraint("bank_id", "position", name="uq_interview_question_position"),
    )


class InterviewAttempt(Base):
    """A student's mock interview session."""
    __tablename__ = "interview_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False)
    bank_id = Column(Integer, ForeignKey("interview_question_banks.id", ondelete="SET NULL"), nullable=True)
    role = Column(String(50), nullable=False)
    category = Column(String(30), default="tech", nullable=False)
    overall_rating = Column(Float, nullable=True)
    strengths = Column(Text, nullable=True)
    improvements = Column(Text, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    attempt_number = Column(Integer, default=1, nullable=False)
    status = Column(String(20), default="completed", nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    student = relationship("User", foreign_keys=[student_id])
    responses = relationship("InterviewResponse", back_populates="attempt", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("category IN ('tech', 'hr', 'commerce', 'custom', 'technical', 'behavioral')", name="ck_ia_category"),
        Index("ix_ia_student", "student_id", "created_at"),
        Index("ix_ia_college", "college_id", "created_at"),
    )


class InterviewResponse(Base):
    """Per-question response within a mock interview."""
    __tablename__ = "interview_responses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    attempt_id = Column(Integer, ForeignKey("interview_attempts.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("interview_questions.id", ondelete="SET NULL"), nullable=True)
    question_text = Column(Text, nullable=True)
    answer_text = Column(Text, nullable=True)
    score = Column(Integer, nullable=True)
    rating = Column(Integer, nullable=True)
    feedback = Column(Text, nullable=True)
    time_taken_seconds = Column(Integer, nullable=True)

    attempt = relationship("InterviewAttempt", back_populates="responses")
    question = relationship("InterviewQuestion", back_populates="responses")

    __table_args__ = (
        CheckConstraint("rating >= 1 AND rating <= 10", name="ck_ir_rating"),
        Index("ix_ir_attempt", "attempt_id"),
    )
