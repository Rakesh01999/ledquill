import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Refetch the given lists and the dashboard numbers they feed. Resolves when the queries that are
 * on screen have answered, so a refresh button can spin until the new rows are there.
 */
export function refreshQueries(queryClient: QueryClient, keys: QueryKey[]): Promise<unknown> {
  return Promise.all([...keys, ["stats"]].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
