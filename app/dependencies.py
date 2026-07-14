"""
Skillovate V2 — FastAPI Dependencies
"""
from typing import Generator
from fastapi import Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.auth_service import AuthService


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db)
