"""
Skillovate V2 — Role-Based Access Control
FastAPI dependencies for role enforcement and college scoping.
"""

from enum import Enum
from typing import Optional

from fastapi import Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_db
from app.core.security import verify_access_token
from app.core.exceptions import (
    InvalidTokenError,
    InsufficientPermissionsError,
    InactiveAccountError,
    AccountPendingError,
)
from app.models.user import User


# ── Role Enum ────────────────────────────────────
class UserRole(str, Enum):
    STUDENT = "student"
    FACULTY = "faculty"
    COLLEGE_ADMIN = "college_admin"
    RECRUITER = "recruiter"
    SUPER_ADMIN = "super_admin"


# ── Bearer Token Extraction ─────────────────────
security_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    db = Depends(get_db),
):
    """
    Extract and validate the current user from the JWT bearer token.
    Raises InvalidTokenError if token is missing/invalid.
    """
    if credentials is None:
        raise InvalidTokenError()

    payload = verify_access_token(credentials.credentials)
    if payload is None:
        raise InvalidTokenError()

    user_id = payload.get("sub")
    if user_id is None:
        raise InvalidTokenError()

    user_doc = db["users"].find_one({"id": int(user_id)})
    if user_doc is None:
        raise InvalidTokenError()

    from app.repositories.base import DotDict
    user = DotDict(user_doc)

    if not user.is_active:
        raise InactiveAccountError()

    if user.status == "pending":
        raise AccountPendingError()

    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    db = Depends(get_db),
):
    """Get current user if token is provided, otherwise return None."""
    if credentials is None:
        return None
    try:
        return await get_current_user(credentials, db)
    except Exception:
        return None


# ── Role Authorization ──────────────────────────
class RoleChecker:
    """
    Dependency class for role-based authorization.

    Usage:
        @router.get("/admin-only", dependencies=[Depends(RoleChecker([UserRole.SUPER_ADMIN]))])
        async def admin_endpoint(): ...

    Or as a dependency that also returns the user:
        current_user: User = Depends(RoleChecker([UserRole.FACULTY, UserRole.COLLEGE_ADMIN]))
    """

    def __init__(self, allowed_roles: list[UserRole]):
        self.allowed_roles = allowed_roles

    async def __call__(self, current_user = Depends(get_current_user)):
        if current_user.role not in [role.value for role in self.allowed_roles]:
            raise InsufficientPermissionsError(role=current_user.role)
        return current_user


# ── Convenience Dependencies ─────────────────────
def require_roles(*roles: UserRole):
    """Factory for creating role-check dependencies."""
    return Depends(RoleChecker(list(roles)))


# Predefined role checkers for common patterns
require_super_admin = Depends(RoleChecker([UserRole.SUPER_ADMIN]))
require_college_admin = Depends(RoleChecker([UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN]))
require_faculty = Depends(RoleChecker([UserRole.FACULTY, UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN]))
require_recruiter = Depends(RoleChecker([UserRole.RECRUITER, UserRole.SUPER_ADMIN]))
require_student = Depends(RoleChecker([UserRole.STUDENT]))
require_any_authenticated = Depends(get_current_user)


# ── College Scoping ──────────────────────────────
class CollegeScope:
    """
    Ensures users can only access their own college's data.
    Super admins bypass this restriction.

    Returns the college_id to scope queries by, or None for super admins.
    """

    async def __call__(
        self,
        current_user = Depends(get_current_user),
    ) -> Optional[int]:
        if current_user.role == UserRole.SUPER_ADMIN.value:
            return None  # Super admin sees everything
        return current_user.college_id or -1


get_college_scope = Depends(CollegeScope())
