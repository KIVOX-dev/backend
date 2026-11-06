from typing import Literal

from pydantic import BaseModel, Field

Personality = Literal["dominator", "fact_quoter", "drifter", "mediator"]
Phase = Literal["opening", "discussion", "nudge", "closing"]


class GdTurnIn(BaseModel):
    speaker: str = Field(max_length=60)
    text: str = Field(max_length=600)


class GdTurnRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=300)
    bot_name: str = Field(min_length=1, max_length=60)
    personality: Personality
    phase: Phase = "discussion"
    # Only the most recent turns are used; callers should send at most ~12.
    transcript: list[GdTurnIn] = Field(default_factory=list, max_length=20)
    # Mediator nudges: who has been quiet and should be invited in.
    invite: str = Field(default="", max_length=60)
    # True when this bot is cutting in on the previous speaker.
    interrupting: bool = False


class GdTurnResponse(BaseModel):
    # "ai" when the LLM wrote the line; "fallback" for the canned line.
    source: Literal["ai", "fallback"]
    text: str
