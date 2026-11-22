import { cache } from "react";
import type { FetchQueryOptions, QueryClient, QueryKey } from "@tanstack/react-query";
import type { ApiClient } from "@/lib/api/client";
import { serverApi } from "@/lib/api/server";
import { makeQueryClient } from "./client";

/** One QueryClient per server request, shared by the layout and the page being rendered. */
export const getQueryClient = cache((): QueryClient => makeQueryClient());

/**
 * Fetch on the server into the request's cache so the browser starts with data already in
 * place. A failure is swallowed: the client component fetches again and shows its own error
 * state, so an API outage never breaks the page shell.
 */
export async function prefetch<T, K extends QueryKey>(
  build: (client: ApiClient) => FetchQueryOptions<T, Error, T, K>,
): Promise<void> {
  try {
    await getQueryClient().prefetchQuery(build(serverApi()));
  } catch {
    /* handled by the client query */
  }
}
