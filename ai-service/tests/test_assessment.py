import json

import respx
from httpx import Response

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def test_generate_questions_falls_back_when_groq_unconfigured(client, auth_headers):
    resp = client.post(
        "/v1/assessment/generate-questions",
        json={"title": "Data Structures", "type": "quiz", "difficulty": "hard"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["questions"]) == 1
    q = body["questions"][0]
    assert "Data Structures" in q["question"]
    assert q["options"] == ["A", "B", "C", "D"]
    assert q["correct_answer"] == "A"


def test_generate_questions_uses_defaults(client, auth_headers):
    resp = client.post("/v1/assessment/generate-questions", json={}, headers=auth_headers)
    assert resp.status_code == 200
    assert "Assessment" in resp.json()["questions"][0]["question"]


@respx.mock
def test_generate_questions_uses_groq_when_configured(client, auth_headers, groq_configured):
    questions = [{"question": "What is a stack?", "options": ["A", "B", "C", "D"], "correct_answer": "B"}]
    respx.post(GROQ_URL).mock(
        return_value=Response(200, json={"choices": [{"message": {"content": json.dumps({"questions": questions})}}]})
    )
    resp = client.post(
        "/v1/assessment/generate-questions", json={"title": "DS", "type": "quiz", "difficulty": "easy"}, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["questions"] == questions


@respx.mock
def test_generate_questions_returns_502_when_groq_fails(client, auth_headers, groq_configured):
    respx.post(GROQ_URL).mock(return_value=Response(500))
    resp = client.post("/v1/assessment/generate-questions", json={}, headers=auth_headers)
    assert resp.status_code == 502


def test_requires_auth(client):
    resp = client.post("/v1/assessment/generate-questions", json={})
    assert resp.status_code == 401
