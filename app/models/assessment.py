"""
Skillovate V2 — Assessment Models
Covers: Questions, Categories, Assessments, Attempts, and Answers.
Fully normalized — no JSON columns.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey,
    Index, UniqueConstraint, CheckConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


# ═══════════════════════════════════════════
# Question Bank
# ═══════════════════════════════════════════

class Category(Base):
    """Question categories: Aptitude, Verbal, Logical, DI, Technical, etc."""
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    slug = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    parent_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Relationships ────────────────────────────
    questions = relationship("Question", back_populates="category")
    subcategories = relationship("Category", backref="parent", remote_side="Category.id")

    def __repr__(self):
        return f"<Category(id={self.id}, name='{self.name}')>"


class Question(Base):
    """Individual questions stored in the question bank."""
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    question_text = Column(Text, nullable=False)
    explanation = Column(Text, nullable=True)
    question_type = Column(String(20), nullable=False, default="mcq")  # mcq, multiple_correct, true_false
    difficulty = Column(String(20), nullable=False, default="medium")  # easy, medium, hard
    marks = Column(Integer, default=1, nullable=False)
    negative_marks = Column(Float, default=0.0, nullable=False)
    time_limit_seconds = Column(Integer, nullable=True)  # Per-question time limit
    tags = Column(Text, nullable=True)  # Comma-separated tags
    company_specific = Column(String(100), nullable=True)  # e.g., "TCS", "Infosys"
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Relationships ────────────────────────────
    category = relationship("Category", back_populates="questions")
    options = relationship("QuestionOption", back_populates="question", cascade="all, delete-orphan", order_by="QuestionOption.position")
    creator = relationship("User", foreign_keys=[created_by])
    assessment_links = relationship("AssessmentQuestion", back_populates="question")

    __table_args__ = (
        CheckConstraint(
            "question_type IN ('mcq', 'multiple_correct', 'true_false')",
            name="ck_questions_type",
        ),
        CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_questions_difficulty",
        ),
        Index("ix_questions_category_difficulty", "category_id", "difficulty"),
        Index("ix_questions_type_active", "question_type", "is_active"),
        Index("ix_questions_company", "company_specific"),
    )

    def __repr__(self):
        return f"<Question(id={self.id}, type='{self.question_type}', difficulty='{self.difficulty}')>"


class QuestionOption(Base):
    """Answer options for a question."""
    __tablename__ = "question_options"

    id = Column(Integer, primary_key=True, autoincrement=True)
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    option_text = Column(Text, nullable=False)
    is_correct = Column(Boolean, default=False, nullable=False)
    position = Column(Integer, nullable=False)  # Display order (1, 2, 3, 4...)

    # ── Relationships ────────────────────────────
    question = relationship("Question", back_populates="options")

    __table_args__ = (
        UniqueConstraint("question_id", "position", name="uq_question_option_position"),
        Index("ix_question_options_question", "question_id"),
    )

    def __repr__(self):
        return f"<QuestionOption(question_id={self.question_id}, pos={self.position}, correct={self.is_correct})>"


# ═══════════════════════════════════════════
# Assessments
# ═══════════════════════════════════════════

class Assessment(Base):
    """A scheduled assessment/test."""
    __tablename__ = "assessments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    assessment_type = Column(String(30), nullable=False)  # aptitude, technical, verbal, logical, di, company_specific, mixed
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    duration_minutes = Column(Integer, nullable=False)
    total_marks = Column(Integer, nullable=False)
    pass_percentage = Column(Float, default=40.0, nullable=False)
    negative_marking = Column(Boolean, default=False, nullable=False)
    shuffle_questions = Column(Boolean, default=True, nullable=False)
    shuffle_options = Column(Boolean, default=False, nullable=False)
    show_result_immediately = Column(Boolean, default=True, nullable=False)
    max_attempts = Column(Integer, default=1, nullable=False)
    target_departments = Column(Text, nullable=True)  # Comma-separated: "CSE,IT,ECE" or "All"
    target_years = Column(String(50), nullable=True)  # Comma-separated: "2024,2025"
    difficulty = Column(String(20), default="medium", nullable=False)
    status = Column(String(20), default="draft", nullable=False)  # draft, scheduled, active, closed
    scheduled_start = Column(DateTime(timezone=True), nullable=True)
    scheduled_end = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Relationships ────────────────────────────
    college = relationship("College", back_populates="assessments")
    creator = relationship("User", foreign_keys=[created_by])
    questions = relationship("AssessmentQuestion", back_populates="assessment", cascade="all, delete-orphan")
    attempts = relationship("AssessmentAttempt", back_populates="assessment")

    __table_args__ = (
        CheckConstraint(
            "assessment_type IN ('aptitude', 'technical', 'verbal', 'logical', 'di', 'company_specific', 'mixed')",
            name="ck_assessments_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'scheduled', 'active', 'closed')",
            name="ck_assessments_status",
        ),
        CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_assessments_difficulty",
        ),
        Index("ix_assessments_college_status", "college_id", "status"),
        Index("ix_assessments_type", "assessment_type"),
        Index("ix_assessments_schedule", "scheduled_start", "scheduled_end"),
    )

    def __repr__(self):
        return f"<Assessment(id={self.id}, title='{self.title}', status='{self.status}')>"


class AssessmentQuestion(Base):
    """Many-to-many link between assessments and questions with ordering."""
    __tablename__ = "assessment_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False)
    section_name = Column(String(100), nullable=True)  # e.g., "Quantitative", "Verbal"

    # ── Relationships ────────────────────────────
    assessment = relationship("Assessment", back_populates="questions")
    question = relationship("Question", back_populates="assessment_links")

    __table_args__ = (
        UniqueConstraint("assessment_id", "question_id", name="uq_assessment_question"),
        UniqueConstraint("assessment_id", "position", name="uq_assessment_question_position"),
        Index("ix_assessment_questions_assessment", "assessment_id"),
    )


# ═══════════════════════════════════════════
# Assessment Attempts & Answers
# ═══════════════════════════════════════════

class AssessmentAttempt(Base):
    """A student's attempt at an assessment."""
    __tablename__ = "assessment_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False)
    attempt_number = Column(Integer, default=1, nullable=False)
    score = Column(Integer, nullable=True)
    max_score = Column(Integer, nullable=True)
    percentage = Column(Float, nullable=True)
    time_taken_seconds = Column(Integer, nullable=True)
    passed = Column(Boolean, nullable=True)
    status = Column(String(20), default="in_progress", nullable=False)  # in_progress, completed, abandoned
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # ── Section-level Results (denormalized for performance) ──
    section_scores = Column(Text, nullable=True)  # Stored as "section:correct/total;..."
    weak_areas = Column(Text, nullable=True)  # Comma-separated weak areas

    # ── Relationships ────────────────────────────
    assessment = relationship("Assessment", back_populates="attempts")
    student = relationship("User", foreign_keys=[student_id])
    answers = relationship("AttemptAnswer", back_populates="attempt", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "status IN ('in_progress', 'completed', 'abandoned')",
            name="ck_assessment_attempts_status",
        ),
        UniqueConstraint("assessment_id", "student_id", "attempt_number", name="uq_attempt_per_student"),
        Index("ix_attempts_student", "student_id", "created_at"),
        Index("ix_attempts_college", "college_id", "created_at"),
        Index("ix_attempts_assessment_status", "assessment_id", "status"),
        Index("ix_attempts_leaderboard", "assessment_id", "percentage"),
    )

    def __repr__(self):
        return f"<AssessmentAttempt(assessment={self.assessment_id}, student={self.student_id}, attempt={self.attempt_number})>"


class AttemptAnswer(Base):
    """Individual answer within an assessment attempt."""
    __tablename__ = "attempt_answers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    attempt_id = Column(Integer, ForeignKey("assessment_attempts.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    selected_option_ids = Column(String(100), nullable=True)  # Comma-separated option IDs
    is_correct = Column(Boolean, nullable=True)
    marks_awarded = Column(Float, default=0.0, nullable=False)
    time_taken_seconds = Column(Integer, nullable=True)
    is_flagged = Column(Boolean, default=False, nullable=False)

    # ── Relationships ────────────────────────────
    attempt = relationship("AssessmentAttempt", back_populates="answers")
    question = relationship("Question")

    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="uq_answer_per_question"),
        Index("ix_attempt_answers_attempt", "attempt_id"),
    )
