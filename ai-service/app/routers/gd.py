import logging
import random
import re

from fastapi import APIRouter, Depends

from app.config import get_settings
from app.db import timed_log
from app.openai_client import OpenAIError, openai_complete
from app.schemas.gd import GdTurnRequest, GdTurnResponse
from app.security import verify_service_token

logger = logging.getLogger("ai-service.gd")
router = APIRouter(prefix="/v1/gd", tags=["group-discussion"], dependencies=[Depends(verify_service_token)])

# Spoken aloud by TTS, so lines stay short: 1-3 sentences, never more than ~45 words.
MAX_WORDS = 45

PERSONA = {
    "dominator": (
        "You are the Dominator: confident, loud, forceful. You push your own view and talk over others. "
        "You are blunt but never abusive or insulting."
    ),
    "fact_quoter": (
        "You are the Fact Quoter: you back points with a statistic or a named study or report. "
        "Only use figures you are reasonably sure of and say 'around' for approximations."
    ),
    "drifter": (
        "You are the Off-topic Drifter: you pick up one word someone said and wander slightly sideways "
        "with a related anecdote or tangent, then half-return to the topic."
    ),
    "mediator": (
        "You are the Mediator and moderator: you briefly summarise what has been said, point out common "
        "ground, and invite quieter people to speak. You keep time and keep it fair."
    ),
}

PHASE_RULES = {
    "opening": "Open the discussion: state the topic in one sentence and give a first opinion.",
    "discussion": "Continue the discussion with one new point that reacts to what was just said.",
    "nudge": "Warmly invite the quiet participant to share their view. Do not answer for them.",
    "closing": "Give the closing summary: the main points made, areas of agreement, and a one-line conclusion.",
}

# Last-resort lines when the LLM is unavailable. {last} = previous speaker's name.
FALLBACKS = {
    "dominator": [
        "I disagree with {last}. We need to be decisive on {topic}, not keep hedging.",
        "Let me be clear: the practical side of {topic} matters more than the theory.",
    ],
    "fact_quoter": [
        "Building on {last}, surveys suggest opinion on {topic} is clearly split, so evidence matters.",
        "Around half of the studies I have seen on {topic} point to mixed outcomes.",
    ],
    "drifter": [
        "That reminds me of something a friend said about {topic}. Anyway, {last}, where were we?",
        "Interesting. It is a bit like how we plan college events, but back to {topic}.",
    ],
    "mediator": [
        "So far {last} and others have raised good points on {topic}. Can we hear from everyone?",
        "Let me summarise: there is agreement on some points and disagreement on others.",
    ],
}
INVITE_FALLBACK = "{invite}, we have not heard your view yet. What do you think about {topic}?"
CLOSING_FALLBACK = "To wrap up: we discussed several sides of {topic}, agreed on a few points, and differed on others."


def _trim_words(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip().strip('"')
    words = text.split(" ")
    if len(words) <= MAX_WORDS:
        return text
    cut = " ".join(words[:MAX_WORDS])
    # Prefer ending on a sentence boundary so speech doesn't stop mid-thought.
    end = max(cut.rfind("."), cut.rfind("?"), cut.rfind("!"))
    return cut[: end + 1] if end > 20 else cut + "."


def _fallback(p: GdTurnRequest) -> str:
    last = next((t.speaker for t in reversed(p.transcript) if t.speaker != p.bot_name), "everyone")
    if p.phase == "nudge" and p.invite:
        return INVITE_FALLBACK.format(invite=p.invite, topic=p.topic)
    if p.phase == "closing":
        return CLOSING_FALLBACK.format(topic=p.topic)
    return random.choice(FALLBACKS[p.personality]).format(last=last, topic=p.topic)


@router.post("/turn", response_model=GdTurnResponse)
async def gd_turn(payload: GdTurnRequest):
    """One spoken line from one bot, reacting to what was actually said."""
    settings = get_settings()
    if not settings.is_openai_configured:
        return GdTurnResponse(source="fallback", text=_fallback(payload))

    history = "\n".join(f"{t.speaker}: {t.text}" for t in payload.transcript[-12:]) or "(nobody has spoken yet)"
    system_prompt = (
        f"You are {payload.bot_name}, a participant in a college-placement group discussion. "
        f"{PERSONA[payload.personality]} "
        "Speak in 1 to 3 short sentences, at most 45 words, in plain spoken English with no lists, "
        "no markdown and no stage directions. Always react to what was actually said."
    )
    extra = ""
    if payload.phase == "nudge" and payload.invite:
        extra = f"The quiet participant to invite is {payload.invite}. "
    if payload.interrupting:
        extra += "You are cutting in on the previous speaker, so start abruptly. "
    user_prompt = (
        f"Topic: {payload.topic}\n"
        f"Discussion so far:\n{history}\n\n"
        f"{PHASE_RULES[payload.phase]} {extra}"
        f"Reply with only the words {payload.bot_name} says aloud."
    )
    async with timed_log("gd.turn") as detail:
        detail["personality"] = payload.personality
        detail["phase"] = payload.phase
        try:
            result = await openai_complete(system_prompt, user_prompt, temperature=0.8, max_tokens=160)
            text = _trim_words(str(result))
            if not text:
                raise OpenAIError("empty GD line")
        except OpenAIError as exc:
            logger.error("GD turn generation failed, using fallback: %s", exc)
            return GdTurnResponse(source="fallback", text=_fallback(payload))
    return GdTurnResponse(source="ai", text=text)
