"""Opt-in tests against real providers (RUN_LIVE_LLM=1 or RUN_LIVE=1, `-m live`).

Budget: at most 3 provider calls (one extraction plus the repair retry plus one slack).
Only the first model in LLM_MODELS is used and only if it is a Groq model; Gemini is never
called by the first test; the second test calls only the configured Gemini model, after a fake
Groq answers 429. Run inside the api container so it uses the container's environment.
"""

from decimal import Decimal

import pytest

from app.llm.base import RateLimited
from app.llm.client import build_llm_client
from app.llm.grounding import ground
from tests.fakes import FakeProvider
from tests.fixtures.builders import MISMATCH_PAGE

pytestmark = pytest.mark.live
MAX_CALLS = 3


def test_first_configured_groq_model_extracts_a_known_invoice(settings, llm_redis):
    first = settings.llm_model_chain[0]
    assert first.startswith("groq:"), "the live test only calls the first (Groq) model"
    assert settings.groq_api_key, "GROQ_API_KEY is not set in this environment"

    client = build_llm_client(settings, redis_client=llm_redis)
    client.chain = [first]  # never Gemini, never the fallbacks
    calls = {"n": 0}
    real = client.providers["groq"]

    class Counting:
        name = "groq"

        def complete(self, *args, **kwargs):
            calls["n"] += 1
            assert calls["n"] <= MAX_CALLS
            return real.complete(*args, **kwargs)

    client.providers = {"groq": Counting()}
    text = "\n".join(MISMATCH_PAGE)
    outcome = client.extract(text, {}, [1])

    assert calls["n"] <= MAX_CALLS and outcome.model == first
    grounded = ground(outcome.result, text).result
    print(f"live: model={outcome.model} calls={calls['n']} tokens={outcome.tokens}")
    assert grounded.invoice_number == "INV-5001"
    assert grounded.total == Decimal("1200.00")


def test_failover_reaches_the_real_gemini_model_when_groq_is_rate_limited(settings, llm_redis):
    """Proves the last step of the chain: Groq is replaced by a fake that always answers 429, so
    only the configured Gemini model is really called (at most MAX_CALLS provider calls)."""
    gemini_spec = next((m for m in settings.llm_model_chain if m.startswith("gemini:")), None)
    assert gemini_spec, "no gemini model is configured in LLM_MODELS"
    assert settings.gemini_api_key, "GEMINI_API_KEY is not set in this environment"

    client = build_llm_client(settings, redis_client=llm_redis)
    client.chain = ["groq:rate-limited", gemini_spec]
    calls = {"n": 0}
    real = client.providers["gemini"]

    class Counting:
        name = "gemini"

        def complete(self, *args, **kwargs):
            calls["n"] += 1
            assert calls["n"] <= MAX_CALLS
            return real.complete(*args, **kwargs)

    client.providers = {
        "groq": FakeProvider("groq", default=RateLimited("429")),
        "gemini": Counting(),
    }
    text = "\n".join(MISMATCH_PAGE)
    outcome = client.extract(text, {}, [1])

    assert outcome.model == gemini_spec and 1 <= calls["n"] <= MAX_CALLS
    assert outcome.prompt_tokens > 0 and outcome.completion_tokens > 0
    grounded = ground(outcome.result, text).result
    print(f"live: model={outcome.model} calls={calls['n']} tokens={outcome.tokens}")
    assert grounded.invoice_number == "INV-5001"
    assert grounded.total == Decimal("1200.00")
