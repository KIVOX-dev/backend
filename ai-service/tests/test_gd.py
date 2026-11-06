import json

import respx
from httpx import Response

BODY = {
    "topic": "Remote work",
    "bot_name": "Arjun",
    "personality": "fact_quoter",
    "transcript": [{"speaker": "You", "text": "I think remote work helps productivity."}],
}


def test_gd_turn_falls_back_when_openai_unconfigured(client, auth_headers):
    resp = client.post("/v1/gd/turn", json=BODY, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "fallback"
    assert data["text"]


def test_gd_nudge_invites_the_quiet_person_in_fallback(client, auth_headers):
    resp = client.post("/v1/gd/turn", json={**BODY, "personality": "mediator", "phase": "nudge", "invite": "Kavi"}, headers=auth_headers)
    assert "Kavi" in resp.json()["text"]


def test_gd_turn_requires_service_token(client):
    assert client.post("/v1/gd/turn", json=BODY).status_code in (401, 403)


def test_gd_turn_rejects_unknown_personality(client, auth_headers):
    assert client.post("/v1/gd/turn", json={**BODY, "personality": "villain"}, headers=auth_headers).status_code == 422


@respx.mock
def test_gd_turn_uses_openai_and_caps_length(client, auth_headers, openai_configured):
    long_line = " ".join(["word"] * 80) + "."
    route = respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=Response(200, json={"choices": [{"message": {"content": long_line}}]})
    )
    resp = client.post("/v1/gd/turn", json=BODY, headers=auth_headers)
    data = resp.json()
    assert data["source"] == "ai"
    assert len(data["text"].split()) <= 46
    sent = json.loads(route.calls.last.request.content)
    assert "Remote work" in sent["messages"][1]["content"]
    assert "You: I think remote work helps productivity." in sent["messages"][1]["content"]


@respx.mock
def test_gd_turn_falls_back_when_openai_errors(client, auth_headers, openai_configured):
    respx.post("https://api.openai.com/v1/chat/completions").mock(return_value=Response(500))
    resp = client.post("/v1/gd/turn", json=BODY, headers=auth_headers)
    assert resp.status_code == 200 and resp.json()["source"] == "fallback"
