"""Gemini through its REST API (httpx; no SDK). The key goes in a header, never in the URL."""

import httpx

from app.llm.base import AuthRejected, Reply, ServerError, post_json
from app.llm.groq import MAX_OUTPUT_TOKENS

BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        self._api_key = api_key
        self._client = client or httpx.Client()

    def complete(self, model: str, system: str, user: str, *, timeout: float) -> Reply:
        if not self._api_key:
            raise AuthRejected("No Gemini API key is configured.")
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": MAX_OUTPUT_TOKENS,
                "responseMimeType": "application/json",
            },
        }
        data = post_json(
            self._client,
            f"{BASE_URL}/{model}:generateContent",
            {"x-goog-api-key": self._api_key},
            body,
            timeout,
        )
        try:
            parts = data["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError, AttributeError) as exc:
            raise ServerError("The provider returned an unexpected body.") from exc
        usage = data.get("usageMetadata") or {}
        return Reply(text=text, tokens=int(usage.get("totalTokenCount") or 0))
