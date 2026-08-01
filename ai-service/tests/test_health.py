def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_health_ready_with_groq_unconfigured(client):
    resp = client.get("/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"]["groq"]["status"] == "not_configured"
    assert body["checks"]["mongo"]["status"] == "not_configured"


def test_health_ready_with_groq_configured(client, groq_configured):
    resp = client.get("/health/ready")
    assert resp.json()["checks"]["groq"]["status"] == "configured"


def test_health_does_not_require_auth(client):
    # Load balancer / orchestrator health probes never carry a service JWT —
    # matches node-api's own /health being registered before its rate
    # limiter/auth stack for the same reason.
    resp = client.get("/health")
    assert resp.status_code == 200
