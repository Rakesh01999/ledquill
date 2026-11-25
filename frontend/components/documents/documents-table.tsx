"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { documentInvoicesOptions } from "@/lib/query/options";
import { prefetchDocument } from "@/lib/query/prefetch";
import { openUploadPicker } from "./upload-section";
import { cn } from "@/lib/utils";

/** What the document is doing, or what it produced; a failed one also offers a new upload. */
function Stage({ doc, wrap = false }: { doc: DocumentOut; wrap?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState(false);
  const text = stageText(doc);
  const running = isActive(doc);
  const failed = doc.status === "failed";
  const hasIssues = doc.status === "completed" && doc.issue_count > 0;

  /** Open the first invoice of this document that has an issue, at its Issues section. */
  async function openFirstIssue(event: MouseEvent) {
    event.stopPropagation();
    setOpening(true);
    try {
      const { items } = await queryClient.fetchQuery(documentInvoicesOptions(api, doc.id));
      const target = items.find((inv) => inv.issues.length > 0);
      if (target) {
        router.push(`/invoices/${target.id}#issues`);
        return;
      }
      toast.info("No open issues found in this document's invoices.");
      router.push(`/documents/${doc.id}`);
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
      setOpening(false);
    }
  }

  const textClass = cn(
    wrap ? "break-words" : "truncate",
    failed ? "text-danger" : hasIssues ? "text-warn" : "text-ink-2",
  );
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {hasIssues ? (
        <button
          type="button"
          title={`Review the issues in ${doc.filename}`}
          aria-label={`${text}. Review issues in ${doc.filename}`}
          disabled={opening}
          onClick={(e) => void openFirstIssue(e)}
          onMouseEnter={() => prefetchDocument(queryClient, doc.id)}
          onFocus={() => prefetchDocument(queryClient, doc.id)}
          className={cn(
            "-my-1 min-w-0 cursor-pointer rounded-sm py-1 text-left underline decoration-dotted underline-offset-2 hover:decoration-solid disabled:cursor-progress disabled:opacity-70",
            textClass,
          )}
        >
          {text}
        </button>
      ) : (
        <span title={text} className={textClass}>
          {text}
          {doc.status === "processing" && <span className="ml-1 text-ink-3 tabular-nums">{doc.progress}%</span>}
        </span>
      )}
      {failed && (
        <button
          type="button"
          onClick={openUploadPicker}
          className="-my-1 w-fit cursor-pointer rounded-sm py-1 text-[13px] font-medium text-link hover:underline"
        >
          Upload a new copy
        </button>
      )}
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

function TypeTile({ type, className }: { type: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-[34px] w-[30px] flex-none items-end justify-center rounded-sm border border-line-strong bg-surface pb-1 font-mono text-[8.5px] font-semibold text-ink-2",
        className,
      )}
    >
      {typeTile(type)}
    </span>
  );
}

const meta = (doc: DocumentOut) =>
  `${formatBytes(doc.size_bytes)}${doc.page_count ? ` · ${doc.page_count} ${doc.page_count === 1 ? "page" : "pages"}` : ""}`;

/**
 * Documents as a table from lg up, and as two-line rows below it: the file on the first line, the
 * status and what it produced on the second, so nothing needs a sideways scroll on a phone.
 */
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
    <>
      <Table className="hidden min-w-[800px] table-fixed lg:table">
        <TableHeader className="sticky top-0 z-10 bg-surface-2 [&_tr]:border-line">
          <TableRow className="h-9 hover:bg-transparent">
            <TableHead className="w-[38%] pl-4 text-xs font-medium text-ink-2">File</TableHead>
            <TableHead className="w-[124px] text-xs font-medium text-ink-2">Status</TableHead>
            <TableHead className="text-xs font-medium text-ink-2">Stage</TableHead>
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
                  <TypeTile type={doc.file_type} />
                  <div className="min-w-0">
                    <Link
                      href={`/documents/${doc.id}`}
                      title={doc.filename}
                      onMouseEnter={() => prefetchDocument(queryClient, doc.id)}
                      onFocus={() => prefetchDocument(queryClient, doc.id)}
                      className="block truncate font-medium text-ink hover:text-link hover:underline"
                    >
                      {doc.filename}
                    </Link>
                    <div className="truncate text-xs text-ink-3">{meta(doc)}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <StatusChip status={doc.status} />
              </TableCell>
              <TableCell>
                <Stage doc={doc} />
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
                  // The file name is the same link, so this one stays out of the tab order.
                  <Button asChild variant="ghost" size="sm" className="text-link">
                    <Link href={`/documents/${doc.id}`} tabIndex={-1} aria-hidden="true">
                      Open
                    </Link>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className="divide-y divide-line lg:hidden">
        {items.map((doc) => (
          <li key={doc.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <TypeTile type={doc.file_type} />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/documents/${doc.id}`}
                  title={doc.filename}
                  onFocus={() => prefetchDocument(queryClient, doc.id)}
                  className="block truncate font-medium text-ink hover:text-link hover:underline"
                >
                  {doc.filename}
                </Link>
                <div className="truncate text-xs text-ink-3" suppressHydrationWarning>
                  {meta(doc)} · {formatWhen(doc.created_at)}
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 pl-[42px]">
              <StatusChip status={doc.status} />
              <div className="min-w-0 flex-1 basis-40">
                <Stage doc={doc} wrap />
              </div>
              {doc.status === "failed" && (
                <Button variant="outline" size="sm" onClick={() => void reprocess(doc)}>
                  Reprocess
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
