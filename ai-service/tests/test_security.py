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
