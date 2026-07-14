"""
Skillovate V2 — Pagination Utilities
Offset-based pagination with consistent response format.
"""

from typing import TypeVar, Generic, Optional, Sequence
from pydantic import BaseModel, Field
from sqlalchemy.orm import Query


T = TypeVar("T")


class PaginationParams(BaseModel):
    """Query parameters for pagination."""
    page: int = Field(default=1, ge=1, description="Page number (1-indexed)")
    per_page: int = Field(default=20, ge=1, le=100, description="Items per page")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.per_page


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard paginated response wrapper."""
    items: list[T]
    total: int
    page: int
    per_page: int
    total_pages: int
    has_next: bool
    has_prev: bool


def paginate(
    query: Query,
    page: int = 1,
    per_page: int = 20,
) -> dict:
    """
    Apply pagination to a SQLAlchemy query.
    Returns dict with items, total, page info.
    """
    total = query.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    offset = (page - 1) * per_page

    items = query.offset(offset).limit(per_page).all()

    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
    }
