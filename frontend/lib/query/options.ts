import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { unwrap, type ApiClient } from "@/lib/api/client";
import type { DocumentStatus, FileType } from "@/lib/api/types";
import type { InvoiceListParams } from "@/lib/invoices";

/**
 * Query option factories. Each takes the client so the same definition (and the same query key)
 * serves server prefetching (server client, key added server-side) and the browser (proxy client).
 */

export const statsOptions = (client: ApiClient) =>
  queryOptions({
    queryKey: ["stats"],
    queryFn: () => unwrap(client.GET("/api/v1/stats")),
    staleTime: 30_000,
  });

export const healthOptions = (client: ApiClient) =>
  queryOptions({
    queryKey: ["health"],
    queryFn: async () => {
      const { response } = await client.GET("/api/v1/health");
      return { ok: response.ok };
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

/** Invoices over time, top suppliers and the currency split for a date range (invoice_date). */
export const trendsOptions = (client: ApiClient, range: { date_from?: string; date_to?: string }) =>
  queryOptions({
    queryKey: ["stats", "trends", range.date_from ?? null, range.date_to ?? null],
    queryFn: ({ signal }) =>
      unwrap(client.GET("/api/v1/stats/trends", { signal, params: { query: { date_from: range.date_from, date_to: range.date_to } } })),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

/** The few invoices that most need a person: the head of the review queue. */
export const ATTENTION_LIMIT = 5;
export const attentionOptions = (client: ApiClient) =>
  queryOptions({
    queryKey: ["invoices", "attention"],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/invoices", {
          params: { query: { status: ["needs_review"], sort: "severity", limit: ATTENTION_LIMIT } },
        }),
      ),
    staleTime: 15_000,
  });

export type DocumentListParams = {
  status?: DocumentStatus;
  file_type?: FileType;
  page: number;
  size: number;
  /** List only archived documents (the Archived page). Left out, archived ones are hidden. */
  archived?: boolean;
};

export const documentsOptions = (client: ApiClient, params: DocumentListParams) =>
  queryOptions({
    queryKey: ["documents", "list", params],
    // `signal` aborts the request when the query key changes or the view unmounts.
    queryFn: ({ signal }) =>
      unwrap(
        client.GET("/api/v1/documents", {
          signal,
          params: {
            query: {
              status: params.status,
              file_type: params.file_type,
              archived: params.archived,
              limit: params.size,
              offset: (params.page - 1) * params.size,
            },
          },
        }),
      ),
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });

export const documentOptions = (client: ApiClient, id: string) =>
  queryOptions({
    queryKey: ["documents", "detail", id],
    queryFn: () =>
      unwrap(client.GET("/api/v1/documents/{document_id}", { params: { path: { document_id: id } } })),
    staleTime: 5_000,
  });

export const eventsOptions = (client: ApiClient, id: string) =>
  queryOptions({
    queryKey: ["documents", "events", id],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/documents/{document_id}/events", {
          params: { path: { document_id: id }, query: { limit: 100 } },
        }),
      ),
    staleTime: 10_000,
  });

export const pagesOptions = (client: ApiClient, id: string) =>
  queryOptions({
    queryKey: ["documents", "pages", id],
    queryFn: () =>
      unwrap(client.GET("/api/v1/documents/{document_id}/pages", { params: { path: { document_id: id } } })),
    staleTime: 60_000,
  });

/** The invoices of one file. `archived` lists the archived ones instead (an archived file's page). */
export const documentInvoicesOptions = (client: ApiClient, id: string, archived = false) =>
  queryOptions({
    queryKey: ["invoices", "by-document", id, archived],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/invoices", {
          params: { query: { document_id: id, limit: 100, archived } },
        }),
      ),
    staleTime: 10_000,
  });

export const QUEUE_LIMIT = 100;

/** The review queue: needs_review invoices, worst first (errors, warnings, low confidence, oldest). */
export const queueOptions = (client: ApiClient) =>
  queryOptions({
    queryKey: ["invoices", "queue"],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/invoices", {
          params: { query: { status: ["needs_review"], sort: "severity", limit: QUEUE_LIMIT } },
        }),
      ),
    staleTime: 10_000,
  });

export const invoicesOptions = (client: ApiClient, params: InvoiceListParams, archived = false) =>
  queryOptions({
    queryKey: ["invoices", "list", archived ? { ...params, archived } : params],
    queryFn: ({ signal }) =>
      unwrap(
        client.GET("/api/v1/invoices", {
          signal,
          params: {
            query: {
              q: params.q,
              status: params.status ? [params.status] : undefined,
              supplier_exact: params.supplier,
              currency: params.currency,
              sort: params.sort,
              order: params.order,
              date_from: params.date_from,
              date_to: params.date_to,
              min_total: params.min_total,
              max_total: params.max_total,
              archived,
              limit: params.size,
              offset: (params.page - 1) * params.size,
            },
          },
        }),
      ),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });

/** Ranked hybrid search. One list, no pages: the API returns the top results only. */
export const SEARCH_LIMIT = 50;
export const searchOptions = (client: ApiClient, q: string) =>
  queryOptions({
    queryKey: ["invoices", "search", q],
    queryFn: ({ signal }) =>
      unwrap(client.GET("/api/v1/search", { signal, params: { query: { q, mode: "hybrid", limit: SEARCH_LIMIT } } })),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

/** Distinct suppliers and currencies for the filter dropdowns. `q` narrows the supplier list. */
export const facetsOptions = (client: ApiClient, q = "") =>
  queryOptions({
    queryKey: ["invoices", "facets", q],
    queryFn: ({ signal }) =>
      unwrap(client.GET("/api/v1/invoices/facets", { signal, params: { query: { q: q || undefined, limit: 100 } } })),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

/** The top-bar search: live documents, invoices and suppliers, and archived items apart. */
export const globalSearchOptions = (client: ApiClient, q: string) =>
  queryOptions({
    queryKey: ["search", "global", q],
    // `signal` cancels the request when the text changes or the palette closes.
    queryFn: ({ signal }) =>
      unwrap(client.GET("/api/v1/search/global", { signal, params: { query: { q, limit: 5 } } })),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

export const invoiceOptions = (client: ApiClient, id: string) =>
  queryOptions({
    queryKey: ["invoices", "detail", id],
    queryFn: () =>
      unwrap(client.GET("/api/v1/invoices/{invoice_id}", { params: { path: { invoice_id: id } } })),
    staleTime: 15_000,
  });
