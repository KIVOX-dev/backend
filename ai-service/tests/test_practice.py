import json

import respx
from httpx import Response

ITEMS = [
    {"question": "What is the output? let x = 15; console.log(++x + x++);", "options": ["32", "31", "30", "33"], "correct_answer": "32"},
    {"question": "Which data structure uses LIFO?", "options": ["Array", "Stack", "Graph", "Queue"], "correct_answer": "Stack"},
]
GROQ = "https://api.groq.com/openai/v1/chat/completions"


def _groq(content: dict):
    return Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})


def test_explain_requires_service_token(client):
    assert client.post("/v1/practice/explain", json={"questions": ITEMS}).status_code in (401, 403)


def test_explain_is_unavailable_without_groq(client, auth_headers):
    resp = client.post("/v1/practice/explain", json={"questions": ITEMS}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "unavailable"
    assert [e["text"] for e in body["explanations"]] == [None, None]


def test_explain_validates_input(client, auth_headers):
    assert client.post("/v1/practice/explain", json={"questions": []}, headers=auth_headers).status_code == 422
    too_many = {"questions": ITEMS * 11}
    assert client.post("/v1/practice/explain", json=too_many, headers=auth_headers).status_code == 422
    one_option = {"questions": [{"question": "q", "options": ["a"], "correct_answer": "a"}]}
    assert client.post("/v1/practice/explain", json=one_option, headers=auth_headers).status_code == 422


@respx.mock
def test_explain_maps_explanations_back_by_question_number(client, auth_headers, groq_configured):
    # Returned out of order, with one entry missing its text — the response must still line up with the request.
    route = respx.post(GROQ).mock(return_value=_groq({"explanations": [
        {"n": 2, "explanation": "A stack is last-in, first-out.", "disputed": False},
        {"n": 1, "explanation": "++x makes x 16 and returns 16; x++ returns 16 then x becomes 17. 16 + 16 = 32."},
        {"n": 9, "explanation": "out of range"},
    ]}))
    resp = client.post("/v1/practice/explain", json={"questions": ITEMS}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "ai"
    assert body["explanations"][0]["text"].endswith("= 32.")
    assert body["explanations"][1]["text"] == "A stack is last-in, first-out."
    prompt = json.loads(route.calls[0].request.content)["messages"][1]["content"]
    assert "Answer key: Stack" in prompt and "Question 2:" in prompt


@respx.mock
def test_explain_surfaces_a_disputed_answer_key(client, auth_headers, groq_configured):
    respx.post(GROQ).mock(return_value=_groq({"explanations": [
        {"n": 1, "explanation": "The sum is 17, not 18.", "disputed": True, "suggested_answer": "17"},
    ]}))
    resp = client.post("/v1/practice/explain", json={"questions": ITEMS[:1]}, headers=auth_headers)
    first = resp.json()["explanations"][0]
    assert first["disputed"] is True and first["suggested_answer"] == "17"


@respx.mock
def test_explain_degrades_when_groq_fails(client, auth_headers, groq_configured):
    respx.post(GROQ).mock(return_value=Response(500))
    resp = client.post("/v1/practice/explain", json={"questions": ITEMS}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["source"] == "unavailable"
