import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { ApiProblem } from "@/lib/api/problem";

/** Retry only what can succeed on a second try: network failures and 5xx, at most twice. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiProblem && error.status < 500) return false;
  return failureCount < 2;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
        // 0.5 s then 1 s: a failing API shows its error state within about two seconds.
        retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2_000),
      },
      mutations: { retry: false },
      dehydrate: {
        shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query),
      },
    },
  });
}
