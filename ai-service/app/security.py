from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

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


async def verify_service_token(authorization: str | None = Header(default=None)) -> None:
    """Every AI route depends on this — only node-api (the sole caller,
    server-to-server, never a browser) holds the shared secret needed to
    produce a token that verifies here. A missing/invalid/expired token is
    always 401, with no distinction given in the response about which check
    failed, so a caller fishing for the shared secret learns nothing more
    from an expired-but-otherwise-valid token than from a garbage one."""
    settings = get_settings()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        jwt.decode(
            token,
            settings.ai_service_shared_secret,
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            issuer=ISSUER,
        )
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc
