"""
Skillovate V2 — API v1 Router
"""
from fastapi import APIRouter
from app.api.v1 import (
    achievements,
    assessments,
    auth,
    batches,
    colleges,
    dashboard,
    interviews,
    persistence,
    placements,
    profile,
    students,
    tests,
    jobs,
    users,
    chat,
    ai,
    resume,
)

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(profile.router)
api_router.include_router(users.router)
api_router.include_router(colleges.router)
api_router.include_router(students.router)
api_router.include_router(assessments.router)
api_router.include_router(tests.router)
api_router.include_router(batches.router)
api_router.include_router(interviews.router)
api_router.include_router(placements.router)
api_router.include_router(achievements.router)
api_router.include_router(dashboard.router)
api_router.include_router(persistence.router)
api_router.include_router(jobs.router)
api_router.include_router(chat.router)
api_router.include_router(ai.router)
api_router.include_router(resume.router)
