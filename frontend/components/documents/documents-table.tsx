"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusChip } from "@/components/shared/status-chip";
import { api, unwrap } from "@/lib/api/client";
import { describeError } from "@/lib/api/problem";
import type { DocumentOut } from "@/lib/api/types";
import { formatBytes } from "@/lib/format";
import { DOC_ROW, formatWhen, isActive, stageText, typeTile } from "@/lib/documents";
import { prefetchDocument } from "@/lib/query/prefetch";
import { cn } from "@/lib/utils";

function Stage({ doc }: { doc: DocumentOut }) {
  const text = stageText(doc);
  const running = isActive(doc);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span
        title={doc.status === "failed" ? text : undefined}
        className={cn("truncate", doc.status === "failed" ? "text-danger" : "text-ink-2")}
      >
        {text}
        {doc.status === "processing" && <span className="ml-1 text-ink-3 tabular-nums">{doc.progress}%</span>}
      </span>
      {running && (
        <div
          role="progressbar"
          aria-label={`Progress for ${doc.filename}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={doc.progress}
          className="h-0.5 max-w-60 rounded-full bg-skeleton"
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${doc.progress}%` }} />
        </div>
      )}
    </div>
  );
}

export function DocumentsTable({ items }: { items: DocumentOut[] }) {
  const queryClient = useQueryClient();

  async function reprocess(doc: DocumentOut) {
    try {
      await unwrap(
        api.POST("/api/v1/documents/{document_id}/reprocess", { params: { path: { document_id: doc.id } } }),
      );
      toast.success("Reprocessing queued");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    }
  }

  return (
    <Table className="min-w-[860px] table-fixed">
      <TableHeader className="sticky top-0 z-10 bg-surface-2 [&_tr]:border-line">
        <TableRow className="h-9 hover:bg-transparent">
          <TableHead className="w-[30%] pl-4 text-xs font-medium text-ink-2">File</TableHead>
          <TableHead className="w-[124px] text-xs font-medium text-ink-2">Status</TableHead>
          <TableHead className="w-[26%] text-xs font-medium text-ink-2">Stage</TableHead>
          <TableHead className="w-20 text-right text-xs font-medium text-ink-2">Invoices</TableHead>
          <TableHead className="w-[72px] text-right text-xs font-medium text-ink-2">Issues</TableHead>
          <TableHead className="w-[116px] text-right text-xs font-medium text-ink-2">Uploaded</TableHead>
          <TableHead className="w-[112px] pr-4 text-right text-xs font-medium text-ink-2">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((doc) => (
          <TableRow key={doc.id} className={cn(DOC_ROW, "border-line hover:bg-surface-2/60")}>
            <TableCell className="pl-4">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-[34px] w-[30px] flex-none items-end justify-center rounded-sm border border-line-strong bg-surface pb-1 font-mono text-[8.5px] font-semibold text-ink-2"
                >
                  {typeTile(doc.file_type)}
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/documents/${doc.id}`}
                    onMouseEnter={() => prefetchDocument(queryClient, doc.id)}
                    onFocus={() => prefetchDocument(queryClient, doc.id)}
                    className="block truncate font-medium text-ink hover:text-link hover:underline"
                  >
                    {doc.filename}
                  </Link>
                  <div className="truncate text-xs text-ink-3">
                    {formatBytes(doc.size_bytes)}
                    {doc.page_count ? ` · ${doc.page_count} ${doc.page_count === 1 ? "page" : "pages"}` : ""}
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <StatusChip status={doc.status} />
            </TableCell>
            <TableCell>
              <Stage doc={doc} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {doc.status === "completed" ? doc.invoice_count : <span className="text-ink-3">—</span>}
            </TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                doc.issue_count > 0 ? "font-medium text-warn" : "text-ink-3",
              )}
            >
              {doc.status === "completed" ? (doc.issue_count > 0 ? doc.issue_count : "None") : "—"}
            </TableCell>
            <TableCell className="text-right text-ink-2" suppressHydrationWarning>
              {formatWhen(doc.created_at)}
            </TableCell>
            <TableCell className="pr-4 text-right">
              {doc.status === "failed" && (
                <Button variant="ghost" size="sm" className="text-link" onClick={() => void reprocess(doc)}>
                  Reprocess
                </Button>
              )}
              {doc.status === "completed" && (
                <Button asChild variant="ghost" size="sm" className="text-link">
                  <Link href={`/documents/${doc.id}`}>Open</Link>
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
