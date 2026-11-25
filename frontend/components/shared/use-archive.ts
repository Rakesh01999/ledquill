"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, unwrap } from "@/lib/api/client";
import { describeError, type ProblemMessage } from "@/lib/api/problem";

export type ArchiveKind = "document" | "invoice";

/** `onError` takes over error reporting (a dialog shows it) instead of the default toast. */
export type CallOptions = { onError?: (message: ProblemMessage) => void };

const post = {
  "document:archive": (id: string) =>
    unwrap(api.POST("/api/v1/documents/{document_id}/archive", { params: { path: { document_id: id } } })),
  "document:restore": (id: string) =>
    unwrap(api.POST("/api/v1/documents/{document_id}/restore", { params: { path: { document_id: id } } })),
  "invoice:archive": (id: string) =>
    unwrap(api.POST("/api/v1/invoices/{invoice_id}/archive", { params: { path: { invoice_id: id } } })),
  "invoice:restore": (id: string) =>
    unwrap(api.POST("/api/v1/invoices/{invoice_id}/restore", { params: { path: { invoice_id: id } } })),
} as const;

/**
 * Archive, restore and reprocess, shared by every table and both detail pages. Archiving is
 * reversible, so there is no confirmation: a toast with Undo follows. Every call refreshes the
 * lists, the review queue and the dashboard numbers. A failure is shown as a toast with the
 * API's own reason ("the document is still processing"), never a generic message.
 */
export function useArchiveActions() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["documents"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
  }, [queryClient]);

  const run = useCallback(
    async (key: string, request: () => Promise<unknown>, options?: CallOptions): Promise<boolean> => {
      setBusy((prev) => new Set(prev).add(key));
      try {
        await request();
        return true;
      } catch (error) {
        const problem = describeError(error);
        if (options?.onError) options.onError(problem);
        else toast.error(problem.title, { description: problem.message });
        return false;
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        refresh();
      }
    },
    [refresh],
  );

  const restore = useCallback(
    async (kind: ArchiveKind, id: string, label: string, options?: CallOptions): Promise<boolean> => {
      const ok = await run(`${kind}:${id}`, () => post[`${kind}:restore`](id), options);
      if (ok) toast.success(`Restored ${label}`);
      return ok;
    },
    [run],
  );

  const archive = useCallback(
    async (kind: ArchiveKind, id: string, label: string, options?: CallOptions): Promise<boolean> => {
      const ok = await run(`${kind}:${id}`, () => post[`${kind}:archive`](id), options);
      if (ok) {
        toast.success(`Archived ${label}`, {
          duration: 8000,
          action: { label: "Undo", onClick: () => void restore(kind, id, label) },
        });
      }
      return ok;
    },
    [run, restore],
  );

  const reprocess = useCallback(
    async (id: string, options?: CallOptions): Promise<boolean> => {
      const ok = await run(
        `reprocess:${id}`,
        () => unwrap(api.POST("/api/v1/documents/{document_id}/reprocess", { params: { path: { document_id: id } } })),
        options,
      );
      if (ok) toast.success("Reprocessing queued");
      return ok;
    },
    [run],
  );

  /** True while a call for this row is running, so its buttons can be disabled. */
  const isBusy = useCallback((kind: ArchiveKind | "reprocess", id: string) => busy.has(`${kind}:${id}`), [busy]);

  return { archive, restore, reprocess, isBusy };
}
