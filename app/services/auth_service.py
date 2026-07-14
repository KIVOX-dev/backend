"""
Skillovate V2 — Authentication Service
Business logic for registration, login, and token management.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import (
    DuplicateError,
    InvalidCredentialsError,
    InvalidTokenError,
)
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    verify_refresh_token,
)
from app.models.user import User, StudentProfile, RecruiterProfile, RefreshToken
from app.repositories.user_repo import UserRepository, StudentProfileRepository, RefreshTokenRepository
from app.repositories.college_repo import CollegeRepository
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, UserBriefResponse, ChangePasswordRequest

settings = get_settings()


class AuthService:
    def __init__(self, db: Session):
        self.db = db
        self.user_repo = UserRepository(db)
        self.student_profile_repo = StudentProfileRepository(db)
        self.refresh_token_repo = RefreshTokenRepository(db)
        self.college_repo = CollegeRepository(db)

    def register(self, data: RegisterRequest) -> User:
        """Register a new user and return the user object."""
        if self.user_repo.email_exists(data.email):
            raise DuplicateError(resource="User", field="email")

        # Validate college if provided
        if data.college_id:
            if not self.college_repo.exists(id=data.college_id):
                raise ValueError("Invalid college_id")

        # Create core user
        status = "approved" if data.role == "student" else "pending"
        user_data = {
            "email": data.email.lower(),
            "password_hash": hash_password(data.password),
            "name": data.name,
            "role": data.role,
            "college_id": data.college_id,
            "department": data.department,
            "status": status,
        }
        
        user = self.user_repo.create(user_data)

        # Create role-specific profile
        if data.role == "student":
            self.student_profile_repo.create({
                "user_id": user.id,
                "student_id": data.student_id,
                "year": data.year,
            })
        elif data.role == "recruiter" and data.company_name:
            self.db["recruiter_profiles"].insert_one({
                "user_id": user.id,
                "company_name": data.company_name
            })

        return user

    def _issue_tokens(self, user: User) -> TokenResponse:
        if not user.is_active:
            raise InvalidCredentialsError()
        if user.status == "pending":
            from app.core.exceptions import AccountPendingError
            raise AccountPendingError()
        if user.status != "approved":
            raise InvalidCredentialsError()

        self.user_repo.update_last_login(user)
        access_token = create_access_token(
            subject=str(user.id),
            role=user.role,
            college_id=user.college_id,
        )
        refresh_token, jti, expire = create_refresh_token(subject=str(user.id))

        # Save refresh token in DB
        self.refresh_token_repo.create({
            "user_id": user.id,
            "jti": jti,
            "token_hash": hash_password(refresh_token),  # Optional: hash refresh token for extra security
            "expires_at": expire,
        })

        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            user=UserBriefResponse.model_validate(user),
        )

    def login(self, data: LoginRequest) -> TokenResponse:
        """Authenticate user and return tokens."""
        user = self.user_repo.get_by_email(data.email)
        if not user or not verify_password(data.password, user.password_hash):
            raise InvalidCredentialsError()
        return self._issue_tokens(user)

    def login_with_student_id(self, student_id: str, password: str, college_id: Optional[int] = None) -> TokenResponse:
        profile_query = {"student_id": student_id.upper()}
        profile_doc = self.db["student_profiles"].find_one(profile_query)
        if not profile_doc:
            raise InvalidCredentialsError()
            
        user_query = {"id": profile_doc["user_id"], "role": "student"}
        if college_id:
            user_query["college_id"] = int(college_id)
            
        user_doc = self.db["users"].find_one(user_query)
        if not user_doc:
            raise InvalidCredentialsError()
            
        user = self.user_repo._to_obj(user_doc)
        if not verify_password(password, user.password_hash):
            raise InvalidCredentialsError()
            
        return self._issue_tokens(user)

    def refresh_token(self, refresh_token: str) -> TokenResponse:
        """Generate new access token from refresh token."""
        payload = verify_refresh_token(refresh_token)
        if not payload:
            raise InvalidTokenError()

        jti = payload.get("jti")
        user_id_str = payload.get("sub")
        
        if not jti or not user_id_str:
            raise InvalidTokenError()
            
        user_id = int(user_id_str)

        # Check if token is valid in DB
        db_token = self.refresh_token_repo.get_by_jti(jti)
        if not db_token or db_token.user_id != user_id:
            # Token reuse detected! Revoke all tokens for user.
            if db_token and db_token.is_revoked:
                self.refresh_token_repo.revoke_all_user_tokens(user_id)
            raise InvalidTokenError()

        user = self.user_repo.get_by_id(user_id)
        if not user or not user.is_active or user.status != "approved":
            raise InvalidTokenError()

        # Revoke old refresh token (token rotation)
        self.refresh_token_repo.revoke_token(db_token)

        # Generate new tokens
        access_token = create_access_token(
            subject=str(user.id),
            role=user.role,
            college_id=user.college_id,
        )
        new_refresh_token, new_jti, expire = create_refresh_token(subject=str(user.id))

        # Save new refresh token
        self.refresh_token_repo.create({
            "user_id": user.id,
            "jti": new_jti,
            "token_hash": hash_password(new_refresh_token),
            "expires_at": expire,
        })

        return TokenResponse(
            access_token=access_token,
            refresh_token=new_refresh_token,
            expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            user=UserBriefResponse.model_validate(user),
        )

    def logout(self, user_id: int) -> None:
        """Revoke all refresh tokens for a user (global logout for simplicity)."""
        self.refresh_token_repo.revoke_all_user_tokens(user_id)

    def change_password(self, user_id: int, data: ChangePasswordRequest) -> None:
        """Change a user's password."""
        user = self.user_repo.get_by_id(user_id)
        if not user or not verify_password(data.current_password, user.password_hash):
            raise InvalidCredentialsError("Incorrect current password")
        
        new_hash = hash_password(data.new_password)
        self.user_repo.update(user_id, {"password_hash": new_hash})
