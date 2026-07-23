from typing import Any

from pydantic import BaseModel


class UserDataRequest(BaseModel):
    data: dict[str, Any] = {}


class UserDataResponse(BaseModel):
    success: bool = True
    data: dict[str, Any] = {}
