from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Header, HTTPException, status
from jwt.exceptions import InvalidTokenError

from app.config import get_settings

ALGORITHM = "HS256"
ISSUER = "node-api"
AUDIENCE = "ai-service"


def mint_service_token(shared_secret: str, ttl_seconds: int = 60) -> str:
    """Used only by tests / local tooling — node-api has its own minting
    logic in utils/aiServiceClient.js that must stay byte-for-byte compatible
    with the claims verified below (iss/aud/exp)."""
    now = datetime.now(timezone.utc)
    payload = {"iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + timedelta(seconds=ttl_seconds)}
    return jwt.encode(payload, shared_secret, algorithm=ALGORITHM)


async def verify_service_token(x_service_token: str | None = Header(default=None)) -> None:
    """Every AI route depends on this — only node-api (the sole caller,
    server-to-server, never a browser) holds the shared secret needed to
    produce a token that verifies here. A missing/invalid/expired token is
    always 401, with no distinction given in the response about which check
    failed, so a caller fishing for the shared secret learns nothing more
    from an expired-but-otherwise-valid token than from a garbage one.

    Read from X-Service-Token, not Authorization — this Cloud Run service is
    deployed --no-allow-unauthenticated, so Authorization is already spoken
    for by Cloud Run's own IAM layer (a Google-signed identity token,
    checked before a request ever reaches this app at all; see
    node-api/src/utils/aiServiceClient.js). This check is the second,
    independent layer behind that, not a replacement for it."""
    settings = get_settings()
    if not x_service_token or not x_service_token.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = x_service_token.removeprefix("Bearer ").strip()
    try:
        jwt.decode(
            token,
            settings.ai_service_shared_secret,
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            issuer=ISSUER,
        )
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc
