"""
Skillovate V2 — Models Package
Central import point for all SQLAlchemy models.
Import all models here so Alembic can detect them.
"""

from app.models.college import College, Department
from app.models.user import User, StudentProfile, FacultyProfile, RecruiterProfile, RefreshToken
from app.models.assessment import (
    Category, Question, QuestionOption,
    Assessment, AssessmentQuestion, AssessmentAttempt, AttemptAnswer,
)
from app.models.interview import (
    InterviewQuestionBank, InterviewQuestion,
    InterviewAttempt, InterviewResponse,
)
from app.models.placement import JobPosting, JobApplication, Placement
from app.models.achievement import Achievement, ActivityLog, Batch, BatchStudent
from app.models.persistence import UserDataState

__all__ = [
    # Core
    "College", "Department",
    "User", "StudentProfile", "FacultyProfile", "RecruiterProfile", "RefreshToken",
    # Assessment
    "Category", "Question", "QuestionOption",
    "Assessment", "AssessmentQuestion", "AssessmentAttempt", "AttemptAnswer",
    # Interview
    "InterviewQuestionBank", "InterviewQuestion",
    "InterviewAttempt", "InterviewResponse",
    # Placement
    "JobPosting", "JobApplication", "Placement",
    # System
    "Achievement", "ActivityLog", "Batch", "BatchStudent", "UserDataState",
]
