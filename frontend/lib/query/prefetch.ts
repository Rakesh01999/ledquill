import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { documentInvoicesOptions, documentOptions, eventsOptions, pagesOptions } from "./options";

/** Warm the cache for a document page when its link is hovered or focused. */
export function prefetchDocument(queryClient: QueryClient, id: string): void {
  void queryClient.prefetchQuery(documentOptions(api, id));
  void queryClient.prefetchQuery(eventsOptions(api, id));
  void queryClient.prefetchQuery(pagesOptions(api, id));
  void queryClient.prefetchQuery(documentInvoicesOptions(api, id));
}
