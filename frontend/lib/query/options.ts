import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { unwrap, type ApiClient } from "@/lib/api/client";
import type { DocumentStatus, FileType } from "@/lib/api/types";

/**
 * Query option factories. Each takes the client so the same definition (and the same query key)
 * serves server prefetching (server client, key added server-side) and the browser (proxy client).
 */

export const PAGE_SIZE = 25;

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

export type DocumentListParams = { status?: DocumentStatus; file_type?: FileType; page: number };

export const documentsOptions = (client: ApiClient, params: DocumentListParams) =>
  queryOptions({
    queryKey: ["documents", "list", params],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/documents", {
          params: {
            query: {
              status: params.status,
              file_type: params.file_type,
              limit: PAGE_SIZE,
              offset: (params.page - 1) * PAGE_SIZE,
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

export const documentInvoicesOptions = (client: ApiClient, id: string) =>
  queryOptions({
    queryKey: ["invoices", "by-document", id],
    queryFn: () =>
      unwrap(
        client.GET("/api/v1/invoices", {
          params: { query: { document_id: id, limit: 100 } },
        }),
      ),
    staleTime: 10_000,
  });
