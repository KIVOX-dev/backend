"""
Skillovate V2 — Main API Router
"""
from fastapi import APIRouter
from app.api.v1.router import api_router as v1_router
from app.config import get_settings

settings = get_settings()

api_router = APIRouter()

# Mount API v1
api_router.include_router(v1_router, prefix=settings.API_V1_PREFIX)
api_router.include_router(v1_router, prefix="/api")
