import json

import respx
from httpx import Response

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def _mock_groq(content):
    respx.post(GROQ_URL).mock(return_value=Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]}))


# --- hard-fail routes: analyze, match-jd, suggest, parse ---


def test_analyze_returns_503_when_groq_unconfigured(client, auth_headers):
    resp = client.post("/v1/resume/analyze", json={"resume": {"skills": ["Python"]}}, headers=auth_headers)
    assert resp.status_code == 503
    assert resp.json()["detail"] == "GROQ_API_KEY is not configured"


def test_match_jd_returns_503_when_groq_unconfigured(client, auth_headers):
    resp = client.post(
        "/v1/resume/match-jd", json={"resume": {}, "jd_text": "Looking for a backend engineer"}, headers=auth_headers
    )
    assert resp.status_code == 503


def test_ai_suggest_returns_503_when_groq_unconfigured(client, auth_headers):
    resp = client.post("/v1/resume/suggest", json={"action": "grammar", "content": "helo wrld"}, headers=auth_headers)
    assert resp.status_code == 503


def test_parse_returns_503_when_groq_unconfigured(client, auth_headers):
    resp = client.post("/v1/resume/parse", json={"text": "John Doe, Software Engineer"}, headers=auth_headers)
    assert resp.status_code == 503


@respx.mock
def test_analyze_returns_groq_report_when_configured(client, auth_headers, groq_configured):
    report = {"score": 82, "readability": 90, "suggestions": ["Add more metrics"]}
    _mock_groq(report)
    resp = client.post("/v1/resume/analyze", json={"resume": {"skills": ["Python"]}}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == report


@respx.mock
def test_match_jd_returns_groq_report_when_configured(client, auth_headers, groq_configured):
    report = {"match_percentage": 77, "ats_match_status": "Moderately Compatible"}
    _mock_groq(report)
    resp = client.post(
        "/v1/resume/match-jd", json={"resume": {}, "jd_text": "Looking for a backend engineer"}, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json() == report


@respx.mock
def test_analyze_returns_502_when_groq_fails(client, auth_headers, groq_configured):
    respx.post(GROQ_URL).mock(return_value=Response(500, json={"error": "server error"}))
    resp = client.post("/v1/resume/analyze", json={"resume": {}}, headers=auth_headers)
    assert resp.status_code == 502


# --- ai-suggest: verifies the jd_text field actually reaches the prompt
# (node-api's old aiSuggest() destructured `jdText` while the request body
# only ever carried `jd_text` — always undefined; fixed as part of this
# migration, and this test guards against reintroducing that mismatch) ---


@respx.mock
def test_ai_suggest_cover_letter_includes_jd_text(client, auth_headers, groq_configured):
    captured = {}

    def _capture(request):
        captured["body"] = json.loads(request.content)
        return Response(200, json={"choices": [{"message": {"content": "Dear Hiring Manager..."}}]})

    respx.post(GROQ_URL).mock(side_effect=_capture)

    resp = client.post(
        "/v1/resume/suggest",
        json={"action": "cover_letter", "jd_text": "We need a Python developer", "resume": {"skills": ["Python"]}},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    sent_prompt = captured["body"]["messages"][1]["content"]
    assert "We need a Python developer" in sent_prompt
    assert "undefined" not in sent_prompt


@respx.mock
def test_ai_suggest_skills_parses_embedded_json(client, auth_headers, groq_configured):
    respx.post(GROQ_URL).mock(
        return_value=Response(
            200,
            json={
                "choices": [
                    {"message": {"content": 'Here you go:\n{"technical": ["Python"], "tools": [], "soft": []}\nEnjoy!'}}
                ]
            },
        )
    )
    resp = client.post("/v1/resume/suggest", json={"action": "skills", "content": "Backend"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["result"] == {"technical": ["Python"], "tools": [], "soft": []}


def test_ai_suggest_rejects_invalid_action(client, auth_headers, groq_configured):
    resp = client.post("/v1/resume/suggest", json={"action": "not-a-real-action"}, headers=auth_headers)
    assert resp.status_code == 400


# --- improve: the one soft-fallback route, must never hard-fail ---


def test_improve_soft_falls_back_when_groq_unconfigured(client, auth_headers):
    resp = client.post(
        "/v1/resume/improve",
        json={"objective": "Original objective", "education": "", "skills": "", "experience": ""},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["objective"] == "Original objective"
    assert "not configured" in body["message"].lower()


@respx.mock
def test_improve_returns_groq_output_when_configured(client, auth_headers, groq_configured):
    _mock_groq({"objective": "Improved objective", "education": "E", "skills": "S", "experience": "X"})
    resp = client.post(
        "/v1/resume/improve",
        json={"objective": "orig", "education": "E", "skills": "S", "experience": "X"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["objective"] == "Improved objective"
    assert body["message"] is None
