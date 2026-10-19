import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.security import mint_service_token

TEST_SECRET = "test-shared-secret"


@pytest.fixture(autouse=True)
def _settings_override(monkeypatch):
    """Every test runs with a known, fixed shared secret and OpenAI
    unconfigured by default — individual tests opt into a fake OpenAI key via
    the openai_configured fixture below rather than this one, so "OpenAI is off"
    stays the default assumption matching most real deployments."""
    monkeypatch.setenv("AI_SERVICE_SHARED_SECRET", TEST_SECRET)
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("MONGODB_URI", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    token = mint_service_token(TEST_SECRET)
    return {"X-Service-Token": f"Bearer {token}"}


@pytest.fixture
def openai_configured(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "fake-test-key")
    monkeypatch.setenv("OPENAI_MODEL", "fake-test-model")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
