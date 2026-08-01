"""
Route-registration smoke tests.

These guard against silent routing regressions across FastAPI/Starlette
upgrades. Newer FastAPI stores included routers lazily (as `_IncludedRouter`
entries) instead of eagerly flattening them into `app.routes`, so inspecting
`len(app.routes)` proves nothing — only an actual request does.

A protected endpoint must answer 401 (route exists, auth rejected the caller),
never 404 (route disappeared). No MongoDB connection is needed: auth rejects
these requests before any query runs. Only genuinely auth-gated paths belong
below — a public route (e.g. GET /api/v1/colleges, used by the registration
dropdown) would reach the database and hang without a live server.
"""

import pytest
from starlette.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    # Not used as a context manager on purpose: that would run the lifespan
    # handler, which connects to MongoDB.
    return TestClient(app)


def test_health_endpoint(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/me",
        "/api/v1/users/",
        "/api/v1/resume",
        "/api/v1/dashboard/admin",
        "/api/v1/students",
        "/api/v1/placements",
    ],
)
def test_protected_routes_are_registered(client, path):
    assert client.get(path).status_code == 401, f"{path} should exist but require auth"


def test_unknown_route_still_404s(client):
    assert client.get("/api/v1/definitely-not-a-route").status_code == 404
