import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import {
  documentInvoicesOptions,
  documentOptions,
  eventsOptions,
  invoiceOptions,
  pagesOptions,
} from "./options";

/** Warm the cache for a document page when its link is hovered or focused. */
export function prefetchDocument(queryClient: QueryClient, id: string): void {
  void queryClient.prefetchQuery(documentOptions(api, id));
  void queryClient.prefetchQuery(eventsOptions(api, id));
  void queryClient.prefetchQuery(pagesOptions(api, id));
  void queryClient.prefetchQuery(documentInvoicesOptions(api, id));
}

/** Same for an invoice: the invoice first, then its document's pages once the id is known. */
export function prefetchInvoice(queryClient: QueryClient, id: string): void {
  void queryClient.prefetchQuery(invoiceOptions(api, id)).then(() => {
    const invoice = queryClient.getQueryData(invoiceOptions(api, id).queryKey);
    if (invoice) {
      void queryClient.prefetchQuery(documentOptions(api, invoice.document_id));
      void queryClient.prefetchQuery(pagesOptions(api, invoice.document_id));
    }
  });
}
