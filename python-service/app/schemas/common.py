"""
Skillovate V2 — Common Pydantic Schemas
Shared response models and base schemas.
"""
from datetime import datetime
from typing import Optional, Generic, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")


class MessageResponse(BaseModel):
    """Standard message response."""
    success: bool = True
    message: str


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard paginated response wrapper."""
    items: list[T]
    total: int
    page: int
    per_page: int
    total_pages: int
    has_next: bool
    has_prev: bool


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "healthy"
    version: str = "2.0.0"
    timestamp: datetime
