"""The extraction client: cache, token bucket, failover across models, validation and repair.

Per call: cache hit returns at once. Otherwise each configured model is tried in order:
reserve tokens, call, validate with Pydantic (one repair retry), reconcile usage, cache the
validated result. 429 / 5xx / timeout / 400 / 422 move to the next model; 401 / 403 marks the
provider unusable for the lifetime of this client (one job). All models failing raises
LLMUnavailable (a TransientError) so the worker retries later.
"""

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx
import redis
from pydantic import ValidationError

from app.core.errors import TransientError
from app.core.logging import get_logger
from app.core.settings import Settings
from app.llm.base import (
    AuthRejected,
    BadRequest,
    CallTimeout,
    Provider,
    ProviderError,
    RateLimited,
    Reply,
    ServerError,
)
from app.llm.cache import ResultCache, cache_key
from app.llm.gemini import GeminiProvider
from app.llm.groq import MAX_OUTPUT_TOKENS, GroqProvider
from app.llm.limiter import Limits, TokenBucket
from app.llm.prompts import REPAIR_SUFFIX, build_messages, estimate_tokens, hints_json
from app.schemas.extraction import ExtractionResult

log = get_logger(__name__)
_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)

_REASONS = {
    RateLimited: "rate_limited",
    ServerError: "server_error",
    CallTimeout: "timeout",
    BadRequest: "bad_request",
}


class LLMUnavailable(TransientError):
    """Every configured model failed or is exhausted for now."""


@dataclass
class Outcome:
    result: ExtractionResult  # validated, NOT yet grounded
    model: str  # "provider:model" that produced it
    cached: bool = False
    tokens: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass
class ExtractionClient:
    chain: list[str]  # "provider:model", in failover order
    providers: Mapping[str, Provider]
    limiter: TokenBucket
    cache: ResultCache
    timeout: float
    unusable: set[str] = field(default_factory=set)

    def extract(self, text: str, hints: Mapping[str, Any], pages: Sequence[int]) -> Outcome:
        key = cache_key(text, hints_json(hints))
        if (hit := self.cache.get(key)) is not None:
            log.info("llm_cache_hit")
            return Outcome(hit[0], hit[1], cached=True)

        system, user = build_messages(text, hints, pages)
        for spec in self.chain:
            provider_name, _, model = spec.partition(":")
            provider = self.providers.get(provider_name)
            if provider is None or provider_name in self.unusable:
                continue
            try:
                outcome = self._try_model(provider, spec, model, system, user)
            except AuthRejected:
                self.unusable.add(provider_name)
                log.warning("llm_provider_unusable", provider=provider_name)
                continue
            except _BucketEmpty:
                log.info("llm_failover", model=spec, reason="token_bucket_empty")
                continue
            except ProviderError as exc:
                log.warning("llm_failover", model=spec, reason=_reason(exc))
                continue
            if outcome is None:
                log.warning("llm_failover", model=spec, reason="invalid_output")
                continue
            self.cache.put(key, outcome.result, outcome.model)
            return outcome
        raise LLMUnavailable("No language model was available.")

    def _try_model(
        self, provider: Provider, spec: str, model: str, system: str, user: str
    ) -> Outcome | None:
        """Call one model, with one repair retry on invalid output. None = still invalid."""
        spent = prompt = completion = 0
        for attempt_user in (user, user + REPAIR_SUFFIX):
            reply = self._call(provider, spec, model, system, attempt_user)
            spent += reply.tokens
            prompt += reply.prompt_tokens
            completion += reply.completion_tokens
            log.info(
                "llm_call",
                model=spec,
                prompt_tokens=reply.prompt_tokens,
                completion_tokens=reply.completion_tokens,
            )
            if (result := parse_reply(reply.text)) is not None:
                return Outcome(
                    result, spec, tokens=spent, prompt_tokens=prompt, completion_tokens=completion
                )
            log.info("llm_invalid_output", model=spec)
        return None

    def _call(self, provider: Provider, spec: str, model: str, system: str, user: str) -> Reply:
        estimate = estimate_tokens(system, user) + MAX_OUTPUT_TOKENS
        try:
            reservation = self.limiter.reserve(spec, estimate)
        except redis.RedisError as exc:
            raise LLMUnavailable("The rate limiter is unavailable.") from exc
        if reservation is None:
            raise _BucketEmpty
        try:
            reply = provider.complete(model, system, user, timeout=self.timeout)
        except BaseException:
            self.limiter.release(reservation)  # a failed call spent nothing we can count
            raise
        self.limiter.reconcile(reservation, reply.tokens)
        return reply


class _BucketEmpty(Exception):
    pass


def _reason(exc: ProviderError) -> str:
    return next((r for cls, r in _REASONS.items() if isinstance(exc, cls)), "provider_error")


def parse_reply(text: str) -> ExtractionResult | None:
    """Model text -> validated result, or None if it is not one valid JSON object."""
    cleaned = _FENCE.sub("", _THINK.sub("", text).strip())
    candidates = [cleaned]
    if "{" in cleaned and "}" in cleaned:
        candidates.append(cleaned[cleaned.index("{") : cleaned.rindex("}") + 1])
    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except ValueError:
            continue
        if not isinstance(data, dict):
            continue
        try:
            return ExtractionResult.model_validate(data)
        except ValidationError:
            return None
    return None


def parse_chain(chain: str, available: set[str]) -> list[str]:
    """Keep entries shaped "provider:model" whose provider exists."""
    specs = []
    for entry in (e.strip() for e in chain.split(",")):
        provider, sep, model = entry.partition(":")
        if sep and model and provider in available:
            specs.append(entry)
        else:
            log.warning("llm_model_skipped", entry=entry.split(":")[0])
    return specs


def redis_for_llm(settings: Settings) -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, socket_timeout=5, socket_connect_timeout=5)


def build_llm_client(
    settings: Settings,
    *,
    redis_client: redis.Redis | None = None,
    http: httpx.Client | None = None,
) -> ExtractionClient:
    """Wire the real providers, limits and cache from settings."""
    client = redis_client or redis_for_llm(settings)
    providers: dict[str, Provider] = {
        "groq": GroqProvider(settings.groq_api_key, http),
        "gemini": GeminiProvider(settings.gemini_api_key, http),
    }
    limits = {
        "groq": Limits(settings.groq_tpm_limit, settings.groq_tpd_limit),
        "gemini": Limits(settings.gemini_tpm_limit, settings.gemini_tpd_limit),
    }
    return ExtractionClient(
        chain=parse_chain(settings.llm_models, set(providers)),
        providers=providers,
        limiter=TokenBucket(client, limits, settings.llm_limit_fraction),
        cache=ResultCache(client, settings.llm_cache_ttl_seconds),
        timeout=settings.llm_call_timeout_seconds,
    )
