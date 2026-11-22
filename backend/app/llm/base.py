"""Provider interface and the error classes the failover loop reacts to.

Error messages never carry the API key, the request or the response body.
"""

from dataclasses import dataclass
from typing import Protocol

import httpx


class ProviderError(Exception):
    """Base for every failure of one provider call."""


class RateLimited(ProviderError):  # HTTP 429
    pass


class ServerError(ProviderError):  # HTTP 5xx or a network failure
    pass


class CallTimeout(ProviderError):
    pass


class AuthRejected(ProviderError):  # HTTP 401 / 403, or no key configured
    pass


class BadRequest(ProviderError):  # HTTP 400 / 422 and other 4xx: this model rejects the call
    pass


@dataclass(frozen=True)
class Reply:
    text: str
    tokens: int  # total tokens the provider reports for this call; 0 if it reports none
    prompt_tokens: int = 0
    completion_tokens: int = 0


class Provider(Protocol):
    name: str  # the prefix used in LLM_MODELS, e.g. "groq"

    def complete(self, model: str, system: str, user: str, *, timeout: float) -> Reply: ...


def post_json(
    client: httpx.Client, url: str, headers: dict[str, str], body: dict, timeout: float
) -> dict:
    """POST and map every failure to a ProviderError subclass."""
    try:
        response = client.post(url, headers=headers, json=body, timeout=timeout)
    except httpx.TimeoutException as exc:
        raise CallTimeout("The provider call timed out.") from exc
    except httpx.TransportError as exc:
        raise ServerError(f"Network error: {type(exc).__name__}") from exc
    status = response.status_code
    if status == 429:
        raise RateLimited("Rate limited by the provider.")
    if status in (401, 403):
        raise AuthRejected(f"The provider rejected the credentials (HTTP {status}).")
    if status >= 500:
        raise ServerError(f"Provider error (HTTP {status}).")
    if status >= 400:
        raise BadRequest(f"The provider rejected the request (HTTP {status}).")
    try:
        data = response.json()
    except ValueError as exc:
        raise ServerError("The provider returned a non-JSON body.") from exc
    if not isinstance(data, dict):
        raise ServerError("The provider returned an unexpected body.")
    return data
