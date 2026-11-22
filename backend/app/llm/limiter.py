"""Per-model token bucket in Redis (the worker runs several processes).

A call first *reserves* its estimated tokens against the per-minute and per-day windows, then
*reconciles* with the provider's actual usage, or *releases* the reservation if the call
failed. Limits are enforced at `fraction` (90%) of the provider's published numbers. Windows
are fixed (minute, UTC day), so a burst at a minute boundary is possible; the 10% margin and
the provider's own 429 cover that.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import redis

_RESERVE = """
local n = tonumber(ARGV[1])
local tpm = tonumber(redis.call('GET', KEYS[1]) or '0')
local tpd = tonumber(redis.call('GET', KEYS[2]) or '0')
if tpm + n > tonumber(ARGV[2]) or tpd + n > tonumber(ARGV[3]) then return 0 end
redis.call('INCRBY', KEYS[1], n)
redis.call('EXPIRE', KEYS[1], 120)
redis.call('INCRBY', KEYS[2], n)
redis.call('EXPIRE', KEYS[2], 172800)
return 1
"""

# Adjust only windows that still exist (an expired window must not be recreated without a TTL).
_ADJUST = """
for i = 1, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    local v = redis.call('INCRBY', KEYS[i], ARGV[1])
    if v < 0 then redis.call('SET', KEYS[i], 0, 'KEEPTTL') end
  end
end
return 1
"""


@dataclass(frozen=True)
class Limits:
    tpm: int
    tpd: int


@dataclass(frozen=True)
class Reservation:
    tokens: int
    tpm_key: str
    tpd_key: str


class TokenBucket:
    def __init__(
        self,
        client: redis.Redis,
        limits: dict[str, Limits],
        fraction: float = 0.9,
        now: Callable[[], float] | None = None,
    ) -> None:
        """`limits` is keyed by provider name; `now` returns epoch seconds (Redis TIME)."""
        self._redis = client
        self._limits = limits
        self._fraction = fraction
        self._now = now or self._redis_now
        self._reserve = client.register_script(_RESERVE)
        self._adjust = client.register_script(_ADJUST)

    def _redis_now(self) -> float:
        seconds, micros = self._redis.time()
        return seconds + micros / 1_000_000

    def reserve(self, model: str, tokens: int) -> Reservation | None:
        """Reserve `tokens` for "provider:model". None when either window would overflow."""
        limits = self._limits.get(model.split(":", 1)[0])
        if limits is None:
            return None
        now = self._now()
        minute = int(now // 60)
        day = datetime.fromtimestamp(now, UTC).strftime("%Y%m%d")
        tpm_key, tpd_key = f"llm:tpm:{model}:{minute}", f"llm:tpd:{model}:{day}"
        ok = self._reserve(
            keys=[tpm_key, tpd_key],
            args=[tokens, int(limits.tpm * self._fraction), int(limits.tpd * self._fraction)],
        )
        return Reservation(tokens, tpm_key, tpd_key) if ok else None

    def reconcile(self, reservation: Reservation, actual_tokens: int) -> None:
        """Replace the estimate with what the provider reported (0 keeps the estimate)."""
        if actual_tokens > 0 and actual_tokens != reservation.tokens:
            self._shift(reservation, actual_tokens - reservation.tokens)

    def release(self, reservation: Reservation) -> None:
        self._shift(reservation, -reservation.tokens)

    def _shift(self, reservation: Reservation, delta: int) -> None:
        self._adjust(keys=[reservation.tpm_key, reservation.tpd_key], args=[delta])
