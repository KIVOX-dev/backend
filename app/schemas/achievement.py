from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AchievementResponse(BaseModel):
    id: int
    user_id: int
    college_id: int
    achievement_type: str
    title: str
    description: Optional[str] = None
    source_module: str
    reference_id: Optional[int] = None
    metric_value: Optional[float] = None
    auto_generated: bool
    achieved_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
