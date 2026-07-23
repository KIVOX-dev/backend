"""
Skillovate V2 — Middleware
Request logging, rate limiting, and request timing.
"""

import time
import logging
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("skillovate")


# ── Rate Limiter ─────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"])


# ── Request Logging Middleware ───────────────────
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log every request with timing, method, path, and status."""

    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid4())[:8]
        start_time = time.time()

        # Attach request_id for downstream use
        request.state.request_id = request_id

        logger.info(
            f"[{request_id}] → {request.method} {request.url.path} "
            f"from {request.client.host if request.client else 'unknown'}"
        )

        try:
            response: Response = await call_next(request)
        except Exception as exc:
            duration = time.time() - start_time
            logger.error(
                f"[{request_id}] ✗ {request.method} {request.url.path} "
                f"EXCEPTION in {duration:.3f}s: {exc}"
            )
            raise

        duration = time.time() - start_time
        logger.info(
            f"[{request_id}] ← {request.method} {request.url.path} "
            f"{response.status_code} in {duration:.3f}s"
        )

        response.headers["X-Request-ID"] = request_id
        response.headers["X-Process-Time"] = f"{duration:.3f}"
        return response


# ── Setup Function ───────────────────────────────
def setup_middleware(app: FastAPI):
    """Attach all middleware to the FastAPI app."""
    # Rate limiting
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Request logging
    app.add_middleware(RequestLoggingMiddleware)
