"""Groq and Gemini over httpx.MockTransport: request shape, status mapping, no key leakage."""

import json

import httpx
import pytest

from app.llm.base import (
    AuthRejected,
    BadRequest,
    CallTimeout,
    RateLimited,
    ServerError,
)
from app.llm.gemini import GeminiProvider
from app.llm.groq import GroqProvider

KEY = "sk-test-SECRET-KEY"
GROQ_OK = {"choices": [{"message": {"content": '{"a": 1}'}}], "usage": {"total_tokens": 321}}
GEMINI_OK = {
    "candidates": [{"content": {"parts": [{"text": '{"a": '}, {"text": "1}"}]}}],
    "usageMetadata": {"totalTokenCount": 77},
}


def client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def respond(status: int, body: dict | None = None):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json=body or {})

    return handler, seen


def groq_call(http, model="openai/gpt-oss-120b"):
    return GroqProvider(KEY, http).complete(model, "sys", "usr", timeout=5)


def test_groq_gpt_oss_gets_reasoning_params_and_json_mode():
    handler, seen = respond(200, GROQ_OK)
    reply = groq_call(client(handler))
    body = json.loads(seen[0].content)
    assert reply.text == '{"a": 1}' and reply.tokens == 321
    assert body["reasoning_effort"] == "low" and body["include_reasoning"] is False
    assert body["temperature"] == 0 and body["response_format"] == {"type": "json_object"}
    assert body["messages"][0] == {"role": "system", "content": "sys"}
    assert "tools" not in body and "functions" not in body and "tool_choice" not in body
    assert seen[0].headers["authorization"] == f"Bearer {KEY}"


def test_groq_other_models_do_not_get_reasoning_params():
    handler, seen = respond(200, GROQ_OK)
    groq_call(client(handler), model="qwen/qwen3.8-27b")
    body = json.loads(seen[0].content)
    assert "reasoning_effort" not in body and "include_reasoning" not in body
    assert body["model"] == "qwen/qwen3.8-27b"


@pytest.mark.parametrize(
    ("status", "error"),
    [(429, RateLimited), (500, ServerError), (503, ServerError), (401, AuthRejected),
     (403, AuthRejected), (400, BadRequest), (422, BadRequest), (404, BadRequest)],
)  # fmt: skip
def test_http_statuses_map_to_provider_errors_without_the_key(status, error):
    handler, _ = respond(status, {"error": {"message": f"echo {KEY}"}})
    with pytest.raises(error) as exc:
        groq_call(client(handler))
    assert KEY not in str(exc.value)


def test_timeout_and_network_failures_map_to_provider_errors():
    def timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    def refused(request):
        raise httpx.ConnectError("no route", request=request)

    with pytest.raises(CallTimeout):
        groq_call(client(timeout))
    with pytest.raises(ServerError):
        groq_call(client(refused))


def test_malformed_success_bodies_are_server_errors():
    for body in ({"choices": []}, {"unexpected": True}):
        handler, _ = respond(200, body)
        with pytest.raises(ServerError):
            groq_call(client(handler))


def test_missing_key_is_rejected_without_a_request():
    handler, seen = respond(200, GROQ_OK)
    with pytest.raises(AuthRejected):
        GroqProvider("", client(handler)).complete("m", "s", "u", timeout=5)
    with pytest.raises(AuthRejected):
        GeminiProvider("", client(handler)).complete("m", "s", "u", timeout=5)
    assert seen == []


def test_gemini_sends_the_key_in_a_header_never_in_the_url():
    handler, seen = respond(200, GEMINI_OK)
    reply = GeminiProvider(KEY, client(handler)).complete(
        "gemini-3.8-flash", "sys", "usr", timeout=5
    )
    request = seen[0]
    body = json.loads(request.content)
    assert (reply.text, reply.tokens) == ('{"a": 1}', 77)
    assert request.headers["x-goog-api-key"] == KEY and KEY not in str(request.url)
    assert request.url.path.endswith("/models/gemini-3.8-flash:generateContent")
    assert body["systemInstruction"]["parts"][0]["text"] == "sys"
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["temperature"] == 0 and "tools" not in body


@pytest.mark.parametrize(
    ("status", "error"), [(429, RateLimited), (500, ServerError), (403, AuthRejected),
                          (400, BadRequest)],
)  # fmt: skip
def test_gemini_statuses_map_to_provider_errors(status, error):
    handler, _ = respond(status)
    with pytest.raises(error):
        GeminiProvider(KEY, client(handler)).complete("m", "s", "u", timeout=5)
