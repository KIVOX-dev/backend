"""
Skillovate V2 — Security Module
JWT token creation/verification and password hashing.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()

# ── Password Hashing ────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a plaintext password."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a hash."""
    return pwd_context.verify(plain_password, hashed_password)


# ── JWT Token Management ────────────────────────
def create_access_token(
    subject: str,
    role: str,
    college_id: Optional[int] = None,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Create a JWT access token."""
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {
        "sub": str(subject),
        "role": role,
        "type": "access",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "jti": str(uuid4()),
    }
    if college_id is not None:
        payload["college_id"] = college_id
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(
    subject: str,
    expires_delta: Optional[timedelta] = None,
) -> tuple[str, str, datetime]:
    """
    Create a JWT refresh token.
    Returns: (token_string, jti, expiry_datetime)
    """
    jti = str(uuid4())
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )
    payload = {
        "sub": str(subject),
        "type": "refresh",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "jti": jti,
    }
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token, jti, expire


def decode_token(token: str) -> dict:
    """
    Decode and validate a JWT token.
    Raises JWTError on invalid/expired tokens.
    """
    return jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
    )


def verify_access_token(token: str) -> Optional[dict]:
    """Verify an access token and return payload, or None if invalid."""
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        return payload
    except JWTError:
        return None


def verify_refresh_token(token: str) -> Optional[dict]:
    """Verify a refresh token and return payload, or None if invalid."""
    try:
        payload = decode_token(token)
        if payload.get("type") != "refresh":
            return None
        return payload
    except JWTError:
        return None
