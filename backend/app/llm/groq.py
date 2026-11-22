"""Groq through its OpenAI-compatible chat completions endpoint."""

import httpx

from app.llm.base import AuthRejected, Reply, ServerError, post_json

URL = "https://api.groq.com/openai/v1/chat/completions"
MAX_OUTPUT_TOKENS = 1500


class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        self._api_key = api_key
        self._client = client or httpx.Client()

    def complete(self, model: str, system: str, user: str, *, timeout: float) -> Reply:
        if not self._api_key:
            raise AuthRejected("No Groq API key is configured.")
        body: dict = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "response_format": {"type": "json_object"},
        }
        if "gpt-oss" in model:  # only these models accept the reasoning parameters
            body["reasoning_effort"] = "low"
            body["include_reasoning"] = False
        data = post_json(
            self._client, URL, {"Authorization": f"Bearer {self._api_key}"}, body, timeout
        )
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise ServerError("The provider returned an unexpected body.") from exc
        usage = data.get("usage") or {}
        return Reply(text=text, tokens=int(usage.get("total_tokens") or 0))
