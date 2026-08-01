from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Publicly known — matches .env.example. Never valid in production; see
# Settings.ai_service_shared_secret and main.py's startup check.
DEFAULT_DEV_SECRET = "dev-only-shared-secret-change-me"


class Settings(BaseSettings):
    """Environment configuration for the AI microservice.

    Every field has a safe default so the service can boot (and its /health
    endpoint stay up) even with nothing configured — individual features
    (Groq-backed generation, Mongo-backed request logging) check their own
    "is this configured" flag and degrade rather than crashing at import time.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Service identity / internal auth ---
    # Verified against the JWT node-api mints for every proxied call (see
    # node-api's utils/aiServiceClient.js). Must match exactly on both sides.
    # The default below is a publicly-known placeholder — main.py refuses to
    # start with it when ai_service_env is "production", so a deployment that
    # forgets to set this fails loudly at boot instead of silently accepting
    # tokens anyone could forge.
    ai_service_shared_secret: str = DEFAULT_DEV_SECRET
    service_port: int = 8001

    # Mirrors node-api's NODE_ENV. Only used to decide how strict the
    # startup checks in main.py are — nothing else branches on it.
    ai_service_env: str = "development"

    # --- Groq (LLM provider) ---
    # Every AI-generation route checks `is_groq_configured` and degrades
    # (fallback questions, unmodified resume text, or a clear 503) rather
    # than crashing — matches node-api's groqClient.js philosophy exactly,
    # since node-api used to own this same check before it moved here.
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    groq_base_url: str = "https://api.groq.com/openai/v1"

    # --- MongoDB (optional: request/response observability logging only —
    # this service owns no business data, node-api remains the single
    # source of truth for students/resumes/interview attempts) ---
    mongodb_uri: str = ""
    mongodb_db_name: str = "upscaler_ai_service"

    # --- CORS: browsers never call this service directly (only node-api
    # does, server-to-server), so this stays empty/closed by default. ---
    cors_origins: str = ""

    @property
    def is_production(self) -> bool:
        return self.ai_service_env.lower() == "production"

    @property
    def is_using_default_secret(self) -> bool:
        return self.ai_service_shared_secret == DEFAULT_DEV_SECRET

    @property
    def is_groq_configured(self) -> bool:
        return bool(self.groq_api_key)

    @property
    def is_mongo_configured(self) -> bool:
        return bool(self.mongodb_uri)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
