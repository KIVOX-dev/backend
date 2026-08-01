"""
UpScaler-AI V2 — FastAPI Dependencies
"""

from fastapi import Depends
from pymongo.database import Database

from app.database import get_db
from app.services.auth_service import AuthService


def get_auth_service(db: Database = Depends(get_db)) -> AuthService:
    return AuthService(db)
