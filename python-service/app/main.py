"""
Skillovate V2 — Main FastAPI Application Entry Point
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.core.exceptions import SkillovateException
from app.core.middleware import setup_middleware
from app.api.router import api_router
from app.schemas.common import HealthResponse
from app.services.seed_service import seed_core_data

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("skillovate")

settings = get_settings()


from app.mongodb import connect_to_mongo, close_mongo_connection

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan events (startup/shutdown)."""
    logger.info(f"🚀 Starting {settings.APP_NAME} in {settings.APP_ENV} mode...")
    await connect_to_mongo()
    yield
    await close_mongo_connection()
    logger.info("🛑 Shutting down application...")


# Initialize FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version="2.0.0",
    description="Campus Placement & Assessment Management Platform",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan,
)

# ── CORS Middleware ──────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Custom Middleware ────────────────────────────
setup_middleware(app)


# ── Global Exception Handler ─────────────────────
@app.exception_handler(SkillovateException)
async def skillovate_exception_handler(request: Request, exc: SkillovateException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "message": exc.detail},
    )


# ── Mount Routers ────────────────────────────────
app.include_router(api_router)


# ── Health Check ─────────────────────────────────
@app.get("/health", response_model=HealthResponse, tags=["System"])
def health_check():
    """System health check endpoint."""
    from datetime import datetime, timezone
    return HealthResponse(timestamp=datetime.now(timezone.utc))
