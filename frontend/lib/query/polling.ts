import { useCallback, useRef } from "react";
import { ApiProblem } from "@/lib/api/problem";

/** Delays between polls while nothing changes: quick at first, then easing off. */
const STEPS_MS = [2_000, 2_000, 3_000, 5_000, 10_000];
const DEFAULT_RETRY_AFTER_S = 10;

type PollState<T> = { data: T | undefined; error: Error | null; dataUpdatedAt: number };

/**
 * Interval function for `refetchInterval`. It returns `false` (stop) as soon as `isActive`
 * says the data is final, so polling ends by itself when every row is terminal. While work is
 * running it backs off when polls in a row show the same progress, and waits for `Retry-After`
 * after a 429. TanStack Query pauses it in hidden tabs (`refetchIntervalInBackground` is off).
 *
 * The library may call this more than once per fetch (for example on every render), so the
 * backoff counter only moves when new data has actually arrived (`dataUpdatedAt` changed).
 */
export function useBackoffInterval<T>(isActive: (data: T) => boolean, signature: (data: T) => string) {
  const last = useRef({ at: 0, sig: "", unchanged: 0 });
  return useCallback(
    (query: { state: PollState<T> }): number | false => {
      const { data, error, dataUpdatedAt } = query.state;
      if (error instanceof ApiProblem && error.status === 429) {
        return (error.retryAfter ?? DEFAULT_RETRY_AFTER_S) * 1000;
      }
      if (!data || !isActive(data)) {
        last.current = { at: dataUpdatedAt, sig: "", unchanged: 0 };
        return false;
      }
      if (dataUpdatedAt !== last.current.at) {
        const sig = signature(data);
        last.current = {
          at: dataUpdatedAt,
          sig,
          unchanged: sig === last.current.sig ? last.current.unchanged + 1 : 0,
        };
      }
      return STEPS_MS[Math.min(last.current.unchanged, STEPS_MS.length - 1)] ?? 10_000;
    },
    [isActive, signature],
  );
}
