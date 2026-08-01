import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import get_settings

logger = logging.getLogger("ai-service.db")

_client: AsyncIOMotorClient | None = None


def get_mongo_client() -> AsyncIOMotorClient | None:
    """Lazily created — most local/dev/test runs never set MONGODB_URI at
    all (this service owns no business data; logging is a nice-to-have, not
    a dependency any AI route should ever block on)."""
    global _client
    settings = get_settings()
    if not settings.is_mongo_configured:
        return None
    if _client is None:
        _client = AsyncIOMotorClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)
    return _client


async def ping_mongo() -> bool:
    client = get_mongo_client()
    if client is None:
        return False
    try:
        await client.admin.command("ping")
        return True
    except Exception as exc:  # noqa: BLE001 — health check: any failure means "not ready", full stop
        logger.warning("Mongo ping failed: %s", exc)
        return False


async def log_ai_call(feature: str, *, success: bool, duration_ms: float, detail: dict[str, Any] | None = None) -> None:
    """Best-effort observability only — a logging failure must never fail
    (or even slow down materially) the actual AI request it's describing.
    Node-api keeps the real system of record for anything user-facing."""
    client = get_mongo_client()
    if client is None:
        return
    settings = get_settings()
    try:
        db = client[settings.mongodb_db_name]
        await db.ai_service_logs.insert_one(
            {
                "feature": feature,
                "success": success,
                "duration_ms": duration_ms,
                "detail": detail or {},
                "at": time.time(),
            }
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to write ai_service_logs entry: %s", exc)


@asynccontextmanager
async def timed_log(feature: str):
    start = time.perf_counter()
    detail: dict[str, Any] = {}
    try:
        yield detail
        await log_ai_call(feature, success=True, duration_ms=(time.perf_counter() - start) * 1000, detail=detail)
    except Exception:
        await log_ai_call(feature, success=False, duration_ms=(time.perf_counter() - start) * 1000, detail=detail)
        raise
