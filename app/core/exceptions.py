"""
Skillovate V2 — Custom Exception Classes
Centralized exception hierarchy for consistent error handling.
"""

from fastapi import HTTPException, status


class SkillovateException(HTTPException):
    """Base exception for all Skillovate errors."""

    def __init__(
        self,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail: str = "An unexpected error occurred",
    ):
        super().__init__(status_code=status_code, detail=detail)


# ── Authentication Exceptions ────────────────────
class InvalidCredentialsError(SkillovateException):
    def __init__(self):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )


class TokenExpiredError(SkillovateException):
    def __init__(self):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )


class InvalidTokenError(SkillovateException):
    def __init__(self):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or malformed token",
        )


class InactiveAccountError(SkillovateException):
    def __init__(self):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated. Contact your administrator.",
        )


class AccountPendingError(SkillovateException):
    def __init__(self):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is pending approval",
        )


# ── Authorization Exceptions ────────────────────
class InsufficientPermissionsError(SkillovateException):
    def __init__(self, role: str = ""):
        detail = f"Role '{role}' is not authorized for this resource" if role else "Insufficient permissions"
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


class CollegeScopeViolationError(SkillovateException):
    def __init__(self):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access resources within your own college",
        )


# ── Resource Exceptions ─────────────────────────
class NotFoundError(SkillovateException):
    def __init__(self, resource: str = "Resource", identifier: str = ""):
        detail = f"{resource} not found"
        if identifier:
            detail = f"{resource} with id '{identifier}' not found"
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail,
        )


class DuplicateError(SkillovateException):
    def __init__(self, resource: str = "Resource", field: str = ""):
        detail = f"{resource} already exists"
        if field:
            detail = f"{resource} with this {field} already exists"
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
        )


class ValidationError(SkillovateException):
    def __init__(self, detail: str = "Validation failed"):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        )
