import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import get_settings
from app.db import ping_mongo
from app.routers import assessment, interview, resume

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ai-service")

settings = get_settings()

# The shared secret is the ONLY thing standing between this service and
# anyone who can reach its port — a forged token signed with the publicly
# known default would pass verification on every route. Fail at boot rather
# than serve in that state; a log warning alone would be too easy to miss.
if settings.is_using_default_secret:
    if settings.is_production:
        raise RuntimeError(
            "AI_SERVICE_SHARED_SECRET is still the public default value. Set it to a strong "
            "random secret (and the same value in node-api's AI_SERVICE_SHARED_SECRET) before "
            "running with AI_SERVICE_ENV=production."
        )
    logger.warning(
        "Using the default development AI_SERVICE_SHARED_SECRET — fine locally, but set a real "
        "secret before deploying (AI_SERVICE_ENV=production refuses to start without one)."
    )

# The only caller of this service is node-api (server-to-server, JWT-authed —
# see security.py); rate limiting here is defense in depth against a leaked
# shared secret or a misbehaving node-api instance retrying in a hot loop,
# not a substitute for node-api's own user-facing rate limits.
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

app = FastAPI(title="UpScaler-AI — AI Service", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(interview.router)
app.include_router(resume.router)
app.include_router(assessment.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready():
    # Fresh lookup, not the module-level `settings` snapshot from import
    # time — get_settings() is cached but the cache is invalidated whenever
    # config changes (e.g. tests patch env vars and clear the cache), and a
    # health check that only ever reports the process's start-of-day config
    # would be misleading in any environment where that matters.
    settings = get_settings()
    mongo_ok = await ping_mongo() if settings.is_mongo_configured else None
    checks = {
        "groq": {"status": "configured" if settings.is_groq_configured else "not_configured"},
        "mongo": (
            {"status": "ok" if mongo_ok else "error"} if settings.is_mongo_configured else {"status": "not_configured"}
        ),
    }
    # "ready" only requires the process to be able to serve requests — Groq
    # being unconfigured is a valid, intentionally-supported deployment state
    # (every route degrades gracefully rather than depending on it), so it
    # never fails readiness. An unreachable Mongo *would* fail it, but Mongo
    # here is logging-only, so even that is deliberately not load-bearing.
    return JSONResponse(content={"status": "ready", "checks": checks})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})
