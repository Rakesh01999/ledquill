"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api/client";
import type { InvoiceOut } from "@/lib/api/types";
import type { FieldName } from "@/lib/invoices";
import { invoiceOptions } from "@/lib/query/options";

/** Everything that shows invoice or document counts must refresh after an edit or approval. */
function refreshRelated(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    predicate: (q) => q.queryKey[0] === "invoices" && q.queryKey[1] !== "detail",
  });
  void queryClient.invalidateQueries({ queryKey: ["stats"] });
  void queryClient.invalidateQueries({ queryKey: ["documents", "list"] });
}

type Context = { previous: InvoiceOut | undefined };

/** Show the edit at once; the server's answer (re-validated issues, status) replaces it. */
export function useCorrectInvoice(id: string) {
  const queryClient = useQueryClient();
  const key = invoiceOptions(api, id).queryKey;
  return useMutation<InvoiceOut, Error, { field: FieldName; value: string | null }, Context>({
    // Only the changed field is sent. Money travels as the string the user typed.
    mutationFn: ({ field, value }) =>
      unwrap(
        api.PATCH("/api/v1/invoices/{invoice_id}", {
          params: { path: { invoice_id: id } },
          body: { [field]: value },
        }),
      ),
    onMutate: async ({ field, value }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      if (previous) {
        queryClient.setQueryData(key, {
          ...previous,
          [field]: value,
          confidence: { ...previous.confidence, [field]: 1 },
          corrected_fields: [...new Set([...previous.corrected_fields, field])],
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onSettled: () => refreshRelated(queryClient),
  });
}

export function useApproveInvoice(id: string) {
  const queryClient = useQueryClient();
  const key = invoiceOptions(api, id).queryKey;
  return useMutation<InvoiceOut, Error, void, Context>({
    mutationFn: () => unwrap(api.POST("/api/v1/invoices/{invoice_id}/approve", { params: { path: { invoice_id: id } } })),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      if (previous) queryClient.setQueryData(key, { ...previous, status: "approved" });
      return { previous };
    },
    // The API is the real check: a 409 puts the previous state back and the page shows its reason.
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onSettled: () => refreshRelated(queryClient),
  });
}
