import json

import respx
from httpx import Response

BODY = {"role": "Software Engineer", "company": "TCS", "mcq_topics": [{"section": "Quant", "score": 3}],
        "gd": {"parameter_scores": {"initiative": 4}}, "hr": {"pairs": [{"question": "Tell me about yourself", "answer": "I am a student", "score": 3}]}}


def test_final_report_unavailable_without_openai(client, auth_headers):
    resp = client.post("/v1/interview/final-report", json=BODY, headers=auth_headers)
    assert resp.status_code == 200 and resp.json()["source"] == "unavailable"


def test_final_report_requires_service_token(client):
    assert client.post("/v1/interview/final-report", json=BODY).status_code in (401, 403)


@respx.mock
def test_final_report_uses_openai_and_drops_malformed_items(client, auth_headers, openai_configured):
    content = {
        "strengths": ["Clear voice"], "improvements": ["Add examples"],
        "missed_opportunities": [{"round": 3, "moment": "Thin intro", "sample_better_line": "I built X."}, {"round": 9, "moment": "bad"}, {"nope": 1}],
        "suggestions": [{"text": "Use STAR", "action": "Write 3 stories", "area": "Structure"}, {"text": "missing action"}],
    }
    route = respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]}))
    data = client.post("/v1/interview/final-report", json=BODY, headers=auth_headers).json()
    assert data["source"] == "ai"
    assert len(data["missed_opportunities"]) == 1 and data["missed_opportunities"][0]["round"] == 3
    assert [s["text"] for s in data["suggestions"]] == ["Use STAR"]
    assert "Tell me about yourself" in json.loads(route.calls.last.request.content)["messages"][1]["content"]


@respx.mock
def test_final_report_unavailable_when_openai_fails_or_gives_nothing_usable(client, auth_headers, openai_configured):
    respx.post("https://api.openai.com/v1/chat/completions").mock(return_value=Response(500))
    assert client.post("/v1/interview/final-report", json=BODY, headers=auth_headers).json()["source"] == "unavailable"
