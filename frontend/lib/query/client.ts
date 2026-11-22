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
      },
      mutations: { retry: false },
      dehydrate: {
        shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query),
      },
    },
  });
}
