import pytest

from app.security import mint_service_token


def test_missing_token_is_rejected(client):
    resp = client.post("/v1/interview/generate-questions", json={"role": "Backend Engineer"})
    assert resp.status_code == 401


def test_garbage_token_is_rejected(client):
    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Backend Engineer"},
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert resp.status_code == 401


def test_token_signed_with_wrong_secret_is_rejected(client):
    bad_token = mint_service_token("some-other-secret-entirely")
    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Backend Engineer"},
        headers={"Authorization": f"Bearer {bad_token}"},
    )
    assert resp.status_code == 401


def test_expired_token_is_rejected(client):
    expired = mint_service_token("test-shared-secret", ttl_seconds=-10)
    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Backend Engineer"},
        headers={"Authorization": f"Bearer {expired}"},
    )
    assert resp.status_code == 401


def test_valid_token_is_accepted(client, auth_headers):
    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Backend Engineer"},
        headers=auth_headers,
    )
    assert resp.status_code == 200


# --- Startup guard: the service must never run in production with the
# publicly-known default shared secret (see main.py). ---


def test_default_secret_is_rejected_in_production(monkeypatch):
    import importlib

    from app.config import DEFAULT_DEV_SECRET, get_settings

    monkeypatch.setenv("AI_SERVICE_SHARED_SECRET", DEFAULT_DEV_SECRET)
    monkeypatch.setenv("AI_SERVICE_ENV", "production")
    get_settings.cache_clear()

    import app.main

    with pytest.raises(RuntimeError, match="still the public default"):
        importlib.reload(app.main)

    # Restore a sane module state for any test importing app.main afterwards.
    monkeypatch.setenv("AI_SERVICE_ENV", "development")
    get_settings.cache_clear()
    importlib.reload(app.main)


def test_real_secret_is_accepted_in_production(monkeypatch):
    import importlib

    from app.config import get_settings

    monkeypatch.setenv("AI_SERVICE_SHARED_SECRET", "a-genuinely-set-production-secret")
    monkeypatch.setenv("AI_SERVICE_ENV", "production")
    get_settings.cache_clear()

    import app.main

    importlib.reload(app.main)  # must not raise

    monkeypatch.setenv("AI_SERVICE_ENV", "development")
    get_settings.cache_clear()
    importlib.reload(app.main)
