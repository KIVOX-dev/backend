"""
UpScaler-AI V2 — Application Configuration
Uses Pydantic Settings for type-safe environment variables.
"""

from functools import lru_cache
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ──────────────────────────────
    APP_NAME: str = "UpScaler-AI V2"
    APP_ENV: str = "development"
    # Safe-by-default: DEBUG must be explicitly enabled in a local .env, since
    # it also controls whether /docs, /redoc and /openapi.json are public
    # (see main.py) — a forgotten override should not expose them.
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # ── MongoDB (the only database engine) ───────
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "upscaler_ai"

    # ── JWT ──────────────────────────────────────
    # No default: a placeholder secret here is worse than an app that refuses
    # to start. Set a real random 64-char string in .env / Secret Manager.
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── CORS ─────────────────────────────────────
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:3001"

    # ── Rate Limiting ────────────────────────────
    RATE_LIMIT_PER_MINUTE: int = 60

    # ── Email ────────────────────────────────────
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@upscaler-ai.com"

    # ── Super Admin Seed ─────────────────────────
    # No password default on purpose — set a real one in .env before seeding.
    # Consumed by seed_mongo.py (which reads them from the environment directly,
    # not through this class) — it refuses to run if either is unset.
    SUPER_ADMIN_EMAIL: str = "admin@upscaler-ai.com"
    SUPER_ADMIN_PASSWORD: str = ""
    
    # ── AI Keys ──────────────────────────────────
    GROQ_API_KEY: str | None = None

    # ── Google OAuth ─────────────────────────────
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_OAUTH_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/google/callback"
    FRONTEND_URL: str = "http://localhost:3000"

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, value: Any) -> Any:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production"}:
                return False
            if normalized in {"dev", "development"}:
                return True
        return value

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance."""
    return Settings()
