import json

import respx
from httpx import ConnectError, Request, Response


def test_generate_questions_falls_back_when_groq_unconfigured(client, auth_headers):
    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Backend Engineer", "company": "Acme"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    questions = resp.json()
    assert len(questions) == 10
    assert all(q["type"] == "technical" for q in questions)
    assert all("ACME" in q["text"] and "BACKEND ENGINEER" in q["text"] for q in questions)


def test_generate_questions_defaults_company_to_general(client, auth_headers):
    resp = client.post("/v1/interview/generate-questions", json={"role": "QA Engineer"}, headers=auth_headers)
    assert resp.status_code == 200
    assert all("GENERAL" in q["text"] for q in resp.json())


def test_generate_questions_hr_round_fallback_has_no_technical_questions(client, auth_headers):
    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Software Engineer", "company": "TCS", "round": "hr"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    questions = resp.json()
    assert len(questions) == 10
    assert all(q["type"] == "hr" for q in questions)
    assert not any("closures" in q["text"] or "TCP" in q["text"] for q in questions)


def test_generate_questions_rejects_unknown_round(client, auth_headers):
    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Software Engineer", "round": "karaoke"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@respx.mock
def test_generate_questions_sends_round_to_groq(client, auth_headers, groq_configured):
    route = respx.post("https://api.groq.com/openai/v1/chat/completions").mock(
        return_value=Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({"questions": [f"Q{i}" for i in range(10)]})}}]},
        )
    )

    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Software Engineer", "company": "TCS", "round": "hr"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert all(q["type"] == "hr" for q in resp.json())
    sent = json.loads(route.calls.last.request.content)
    assert "HR round" in sent["messages"][0]["content"]
    assert "Do not ask any technical" in sent["messages"][1]["content"]


def test_generate_questions_rejects_missing_role(client, auth_headers):
    resp = client.post("/v1/interview/generate-questions", json={}, headers=auth_headers)
    assert resp.status_code == 422


@respx.mock
def test_generate_questions_uses_groq_when_configured(client, auth_headers, groq_configured):
    fake_questions = [f"Question {i}" for i in range(1, 11)]
    respx.post("https://api.groq.com/openai/v1/chat/completions").mock(
        return_value=Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({"questions": fake_questions})}}]},
        )
    )

    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Backend Engineer", "company": "Acme"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    questions = resp.json()
    assert [q["text"] for q in questions] == fake_questions
    assert [q["type"] for q in questions[:7]] == ["technical"] * 7
    assert [q["type"] for q in questions[7:]] == ["behavioral"] * 3


@respx.mock
def test_generate_questions_falls_back_when_groq_returns_too_few(client, auth_headers, groq_configured):
    respx.post("https://api.groq.com/openai/v1/chat/completions").mock(
        return_value=Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({"questions": ["only one"]})}}]},
        )
    )

    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Backend Engineer", "company": "Acme"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 10  # fell back to the local pool, never errored


@respx.mock
def test_generate_questions_falls_back_when_groq_unreachable(client, auth_headers, groq_configured):
    def _refuse(request: Request):
        raise ConnectError("connection refused", request=request)

    respx.post("https://api.groq.com/openai/v1/chat/completions").mock(side_effect=_refuse)

    resp = client.post(
        "/v1/interview/generate-questions",
        json={"role": "Backend Engineer", "company": "Acme"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 10


def _groq_mcq_reply(items):
    return Response(200, json={"choices": [{"message": {"content": json.dumps({"questions": items})}}]})


def _mcq(i, section="Quantitative", **overrides):
    item = {"section": section, "question": f"Question {i}?", "options": ["A1", "B1", "C1", "D1"], "correct_answer": "B1"}
    item.update(overrides)
    return item


def test_generate_mcq_unavailable_when_groq_unconfigured(client, auth_headers):
    resp = client.post("/v1/interview/generate-mcq", json={"role": "Data Analyst", "company": "TCS"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"source": "unavailable", "questions": []}


@respx.mock
def test_generate_mcq_prompt_names_role_and_company(client, auth_headers, groq_configured):
    route = respx.post("https://api.groq.com/openai/v1/chat/completions").mock(
        return_value=_groq_mcq_reply([_mcq(i) for i in range(10)])
    )
    resp = client.post(
        "/v1/interview/generate-mcq",
        json={"role": "Data Analyst", "company": "Infosys", "count": 10},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "ai"
    assert len(body["questions"]) == 10
    sent = json.loads(route.calls.last.request.content)
    assert "Infosys" in sent["messages"][0]["content"] and "Data Analyst" in sent["messages"][0]["content"]
    assert "4 technical questions" in sent["messages"][1]["content"]


@respx.mock
def test_generate_mcq_drops_malformed_items_and_maps_letter_answers(client, auth_headers, groq_configured):
    items = [_mcq(i) for i in range(8)] + [
        _mcq(90, options=["only", "three", "options"]),
        _mcq(91, correct_answer="not an option"),
        _mcq(0),  # duplicate question text
        _mcq(92, correct_answer="C"),  # letter answer -> "C1"
    ]
    respx.post("https://api.groq.com/openai/v1/chat/completions").mock(return_value=_groq_mcq_reply(items))
    resp = client.post("/v1/interview/generate-mcq", json={"role": "QA Engineer", "count": 10}, headers=auth_headers)
    questions = resp.json()["questions"]
    assert len(questions) == 9
    assert {q["question"] for q in questions} >= {"Question 92?"}
    assert next(q for q in questions if q["question"] == "Question 92?")["correct_answer"] == "C1"
    assert [q["id"] for q in questions] == list(range(1, 10))


@respx.mock
def test_generate_mcq_groups_sections_with_technical_last(client, auth_headers, groq_configured):
    items = [_mcq(0, "Technical"), _mcq(1, "Verbal"), _mcq(2, "Quantitative"), _mcq(3, "Verbal"), _mcq(4, "Technical")]
    respx.post("https://api.groq.com/openai/v1/chat/completions").mock(return_value=_groq_mcq_reply(items))
    resp = client.post("/v1/interview/generate-mcq", json={"role": "SDE", "count": 5}, headers=auth_headers)
    assert [q["section"] for q in resp.json()["questions"]] == ["Verbal", "Verbal", "Quantitative", "Technical", "Technical"]


@respx.mock
def test_generate_mcq_unavailable_when_too_few_valid(client, auth_headers, groq_configured):
    respx.post("https://api.groq.com/openai/v1/chat/completions").mock(
        return_value=_groq_mcq_reply([_mcq(i) for i in range(5)])
    )
    resp = client.post("/v1/interview/generate-mcq", json={"role": "SDE", "count": 20}, headers=auth_headers)
    assert resp.json() == {"source": "unavailable", "questions": []}


def test_generate_mcq_rejects_out_of_range_count(client, auth_headers):
    resp = client.post("/v1/interview/generate-mcq", json={"role": "SDE", "count": 500}, headers=auth_headers)
    assert resp.status_code == 422
