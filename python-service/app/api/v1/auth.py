"""
UpScaler-AI V2 — Auth Router
"""
from urllib.parse import urlencode, parse_qs

import httpx
from fastapi import APIRouter, Depends, Response, status, HTTPException
from fastapi.responses import RedirectResponse
from app.config import get_settings
from app.schemas.auth import RegisterRequest, LoginRequest, RefreshTokenRequest, UserBriefResponse, ChangePasswordRequest
from app.schemas.common import MessageResponse
from app.services.auth_service import AuthService
from app.dependencies import get_auth_service
from app.core.rbac import get_current_user
from app.core.exceptions import AccountPendingError
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_ALLOWED_ROLES = {"hr", "student", "college_admin", "faculty"}


def _legacy_user(user: UserBriefResponse):
    data = user.model_dump()
    data["_id"] = str(user.id)
    data["collegeId"] = user.college_id
    return data


def _token_payload(token_response):
    user = _legacy_user(token_response.user)
    return {
        "success": True,
        "access_token": token_response.access_token,
        "refresh_token": token_response.refresh_token,
        "token_type": token_response.token_type,
        "expires_in": token_response.expires_in,
        "user": token_response.user,
        "token": token_response.access_token,
        "data": {"user": user, "token": token_response.access_token},
    }


def _set_token_cookie(response: Response, token: str, expires_in: int):
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=expires_in, path="/")


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    data: dict,
    response: Response,
    auth_service: AuthService = Depends(get_auth_service)
):
    """Register a new user account."""
    role = data.get("role") or "student"
    if role == "hr":
        role = "recruiter"
    try:
        request = RegisterRequest(
            email=data.get("email"),
            password=data.get("password"),
            name=data.get("name"),
            role=role,
            college_id=data.get("college_id") or data.get("collegeId"),
            department=data.get("department"),
            student_id=data.get("student_id") or data.get("studentId"),
            year=data.get("year"),
            company_name=data.get("company_name") or data.get("company"),
        )
    except ValueError as e:
        # Pydantic ValidationError is a subclass of ValueError in v2, 
        # but let's import it safely if needed. Or just catch Exception
        # We'll use a direct approach since we just want the message.
        from pydantic import ValidationError
        if isinstance(e, ValidationError):
            raise HTTPException(status_code=400, detail=e.errors()[0]["msg"].replace("Value error, ", ""))
        raise HTTPException(status_code=400, detail=str(e))
    user = auth_service.register(request)
    
    if user.status == "pending":
        return {"success": True, "message": "Registration successful. Please wait for approval.", "data": {"user": {"email": user.email, "status": "pending"}}}
        
    token_response = auth_service.login(LoginRequest(email=request.email, password=request.password))
    _set_token_cookie(response, token_response.access_token, token_response.expires_in)
    return _token_payload(token_response)


@router.post("/login")
def login(
    data: dict,
    response: Response,
    auth_service: AuthService = Depends(get_auth_service)
):
    """Login and receive access & refresh tokens."""
    if data.get("studentId") and not data.get("email"):
        token_response = auth_service.login_with_student_id(
            data["studentId"],
            data.get("password", ""),
            data.get("collegeId") or data.get("college_id"),
        )
    else:
        token_response = auth_service.login(LoginRequest(email=data.get("email"), password=data.get("password", "")))
    _set_token_cookie(response, token_response.access_token, token_response.expires_in)
    return _token_payload(token_response)


@router.post("/refresh")
def refresh_token(
    data: RefreshTokenRequest,
    response: Response,
    auth_service: AuthService = Depends(get_auth_service)
):
    """Refresh an access token using a valid refresh token (token rotation enabled)."""
    token_response = auth_service.refresh_token(data.refresh_token)
    _set_token_cookie(response, token_response.access_token, token_response.expires_in)
    return _token_payload(token_response)


@router.post("/logout", response_model=MessageResponse)
def logout(
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service)
):
    """Logout the user by revoking all their refresh tokens."""
    auth_service.logout(current_user.id)
    return MessageResponse(message="Successfully logged out")


@router.get("/me", response_model=UserBriefResponse)
def get_me(
    current_user: User = Depends(get_current_user)
):
    """Get the current authenticated user's profile info."""
    return UserBriefResponse.model_validate(current_user)


from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.auth import UpdateProfileRequest

@router.put("/update", response_model=UserBriefResponse)
def update_profile(
    data: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db = Depends(get_db)
):
    """Update user profile."""
    update_data = {}
    if data.name is not None:
        update_data["name"] = data.name
        current_user.name = data.name
    if data.department is not None:
        update_data["department"] = data.department
        current_user.department = data.department
    if data.avatar_url is not None:
        update_data["avatar_url"] = data.avatar_url
        current_user.avatar_url = data.avatar_url

    if data.company_name is not None and current_user.role == "recruiter":
        pass # Handle recruiter profile logic if needed

    if update_data:
        db["users"].update_one({"id": current_user.id}, {"$set": update_data})

    return UserBriefResponse.model_validate(current_user)

@router.put("/change-password", response_model=MessageResponse)
def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service)
):
    """Change user password."""
    auth_service.change_password(current_user.id, data)
    return MessageResponse(message="Password changed successfully")


@router.get("/google")
def google_login_redirect(role: str, redirect: str = "/onboarding"):
    """Starts the Google OAuth Authorization Code flow for a given portal role.

    The frontend sends the browser here directly (window.location.href); we
    redirect it on to Google, then Google redirects to /auth/google/callback.
    """
    if role not in GOOGLE_ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on this server")

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
        "state": urlencode({"role": role, "redirect": redirect}),
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/google/callback")
async def google_login_callback(
    code: str,
    state: str = "",
    auth_service: AuthService = Depends(get_auth_service),
):
    """Google's redirect target: exchanges the code, finds/creates the user,
    then hands off to the frontend's /oauth/callback page with tokens (or a
    pending-approval flag) in the query string — never as an httpOnly cookie,
    since the SPA reads the token into localStorage the same way /auth/login does.
    """
    parsed_state = {k: v[0] for k, v in parse_qs(state).items()}
    role = parsed_state.get("role", "student")
    redirect_path = parsed_state.get("redirect", "/onboarding")

    async with httpx.AsyncClient(timeout=10) as client:
        token_res = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
            "grant_type": "authorization_code",
        })
        if token_res.status_code >= 400:
            raise HTTPException(status_code=502, detail="Google token exchange failed")
        google_tokens = token_res.json()

        userinfo_res = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {google_tokens['access_token']}"},
        )
        if userinfo_res.status_code >= 400:
            raise HTTPException(status_code=502, detail="Failed to fetch Google profile")
        profile = userinfo_res.json()

    try:
        token_response = auth_service.google_login(
            email=profile["email"],
            name=profile.get("name") or profile["email"],
            role=role,
        )
    except AccountPendingError:
        return RedirectResponse(f"{settings.FRONTEND_URL}{redirect_path}?pending=1")

    query = urlencode({
        "token": token_response.access_token,
        "refresh": token_response.refresh_token,
        "redirect": redirect_path,
    })
    return RedirectResponse(f"{settings.FRONTEND_URL}/oauth/callback?{query}")
