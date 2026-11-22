"""Token bucket against the compose Redis, DB 15 only (see the llm_redis fixture)."""

import pytest

from app.llm.limiter import Limits, TokenBucket

MODEL = "groq:m1"


class Clock:
    def __init__(self, start: float = 1_800_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now


def bucket(llm_redis, clock, tpm=1000, tpd=10_000, fraction=0.9) -> TokenBucket:
    return TokenBucket(llm_redis, {"groq": Limits(tpm, tpd)}, fraction, now=clock)


def used(llm_redis, kind: str) -> int:
    keys = llm_redis.keys(f"llm:{kind}:*")
    return sum(int(llm_redis.get(k)) for k in keys)


def test_limits_are_enforced_at_ninety_percent(llm_redis):
    b = bucket(llm_redis, Clock())
    assert b.reserve(MODEL, 901) is None  # 90% of 1000 is 900
    assert b.reserve(MODEL, 900) is not None
    assert b.reserve(MODEL, 1) is None


def test_the_minute_window_resets_but_the_day_window_does_not(llm_redis):
    clock = Clock()
    b = bucket(llm_redis, clock, tpm=1000, tpd=2000)  # 900 per minute, 1800 per day
    assert b.reserve(MODEL, 900)
    assert b.reserve(MODEL, 100) is None
    clock.now += 60
    assert b.reserve(MODEL, 900)  # new minute: day total is now 1800
    clock.now += 60
    assert b.reserve(MODEL, 100) is None  # new minute, but the day is exhausted


def test_models_have_separate_buckets(llm_redis):
    b = TokenBucket(llm_redis, {"groq": Limits(1000, 10_000)}, 0.9, now=Clock())
    assert b.reserve("groq:m1", 900) and b.reserve("groq:m2", 900)
    assert b.reserve("groq:m1", 10) is None


def test_unknown_provider_cannot_reserve(llm_redis):
    assert bucket(llm_redis, Clock()).reserve("other:m", 1) is None


def test_reconcile_replaces_the_estimate_with_actual_usage(llm_redis):
    b = bucket(llm_redis, Clock())
    reservation = b.reserve(MODEL, 800)
    b.reconcile(reservation, 300)
    assert used(llm_redis, "tpm") == 300 and used(llm_redis, "tpd") == 300
    b.reconcile(reservation, 0)  # provider reported nothing: keep the current figure
    assert used(llm_redis, "tpm") == 300


def test_reconcile_can_raise_usage_above_the_estimate(llm_redis):
    b = bucket(llm_redis, Clock())
    reservation = b.reserve(MODEL, 100)
    b.reconcile(reservation, 500)
    assert used(llm_redis, "tpm") == 500


def test_release_returns_the_whole_reservation(llm_redis):
    b = bucket(llm_redis, Clock())
    reservation = b.reserve(MODEL, 800)
    b.release(reservation)
    assert used(llm_redis, "tpm") == 0 and used(llm_redis, "tpd") == 0
    assert b.reserve(MODEL, 900)


def test_releasing_after_the_window_expired_does_not_recreate_a_key(llm_redis):
    b = bucket(llm_redis, Clock())
    reservation = b.reserve(MODEL, 800)
    llm_redis.delete(reservation.tpm_key)  # as if the minute window had expired
    b.release(reservation)
    assert not llm_redis.exists(reservation.tpm_key)
    assert used(llm_redis, "tpd") == 0


def test_windows_expire_on_their_own(llm_redis):
    reservation = bucket(llm_redis, Clock()).reserve(MODEL, 10)
    assert 0 < llm_redis.ttl(reservation.tpm_key) <= 120
    assert 0 < llm_redis.ttl(reservation.tpd_key) <= 172_800


def test_the_test_fixture_never_touches_db_zero(llm_redis):
    assert llm_redis.connection_pool.connection_kwargs["db"] == 15


@pytest.mark.parametrize("tokens", [0, 1])
def test_small_reservations_work(llm_redis, tokens):
    assert bucket(llm_redis, Clock()).reserve(MODEL, tokens) is not None
