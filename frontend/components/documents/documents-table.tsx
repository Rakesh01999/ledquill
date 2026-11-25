"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, RotateCw, Archive } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHoverPrefetch } from "@/components/shared/use-hover-prefetch";
import { StatusChip } from "@/components/shared/status-chip";
import { RowAction } from "@/components/shared/row-action";
import { useConfirmedActions } from "@/components/shared/use-confirmed-actions";
import { api } from "@/lib/api/client";
import { describeError } from "@/lib/api/problem";
import type { DocumentOut } from "@/lib/api/types";
import { formatBytes } from "@/lib/format";
import { formatWhen, isActive, stageText, typeTile } from "@/lib/documents";
import { documentInvoicesOptions } from "@/lib/query/options";
import { HEAD, ROW } from "@/lib/table";
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

const WAIT_HINT = "Not available while this file is processing";

/**
 * Open, Reprocess and Archive for one document: the same actions as its detail page. Reprocess
 * and Archive ask first, and wait while the file is queued or processing, as the API would refuse
 * them. In the table the labels collapse to icons below xl (the title and accessible name stay).
 */
function DocumentActions({
  doc,
  actions,
  variant,
}: {
  doc: DocumentOut;
  actions: ReturnType<typeof useConfirmedActions>;
  variant: "table" | "list";
}) {
  const running = isActive(doc);
  const table = variant === "table";
  const kind = table ? "ghost" : "outline";
  return (
    <div className={cn("flex items-center", table ? "-mr-2.5 justify-end gap-0.5 max-xl:-mr-2" : "flex-wrap gap-2")}>
      <RowAction
        icon={ExternalLink}
        label="Open"
        name={`Open ${doc.filename}`}
        href={`/documents/${doc.id}`}
        variant={kind}
        compact={table}
        decorative={false}
      />
      <RowAction
        icon={RotateCw}
        label="Reprocess"
        name={`Reprocess ${doc.filename}`}
        variant={kind}
        compact={table}
        disabled={running || actions.isBusy("reprocess", doc.id)}
        title={running ? WAIT_HINT : undefined}
        onClick={() => actions.askReprocess(doc.id, doc.filename)}
      />
      <RowAction
        icon={Archive}
        label="Archive"
        name={`Archive ${doc.filename}`}
        tone="muted"
        variant={kind}
        compact={table}
        disabled={running || actions.isBusy("document", doc.id)}
        title={running ? WAIT_HINT : undefined}
        onClick={() => actions.askArchive("document", doc.id, doc.filename)}
      />
    </div>
  );
}

/**
 * Documents as a table from lg up, and as two-line rows below it: the file on the first line, the
 * status and what it produced on the second, then the actions, so nothing needs a sideways scroll
 * on a phone.
 */
export function DocumentsTable({ items }: { items: DocumentOut[] }) {
  const queryClient = useQueryClient();
  const hoverPrefetch = useHoverPrefetch();
  const actions = useConfirmedActions();

  return (
    <>
      {actions.dialog}
      <Table bare className="hidden table-fixed lg:table">
        <TableHeader className="bg-surface-2 [&_tr]:border-line">
          <TableRow className="h-9 hover:bg-transparent">
            <TableHead className={cn("w-[32%] pl-4", HEAD)}>File</TableHead>
            <TableHead className={cn("w-[124px]", HEAD)}>Status</TableHead>
            <TableHead className={HEAD}>Stage</TableHead>
            <TableHead className={cn("hidden w-[116px] xl:table-cell", HEAD)}>Uploaded</TableHead>
            <TableHead className={cn("w-[276px] pr-4 text-right max-xl:w-[132px]", HEAD)}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((doc) => (
            <TableRow
              key={doc.id}
              className={cn(ROW, "border-line hover:bg-surface-2/60")}
              {...hoverPrefetch(() => prefetchDocument(queryClient, doc.id))}
            >
              <TableCell className="pl-4">
                <div className="flex min-w-0 items-center gap-3">
                  <TypeTile type={doc.file_type} />
                  <div className="min-w-0">
                    <Link
                      href={`/documents/${doc.id}`}
                      title={doc.filename}
                      onFocus={() => prefetchDocument(queryClient, doc.id)}
                      className="block truncate font-medium text-ink hover:text-link hover:underline"
                    >
                      {doc.filename}
                    </Link>
                    <div className="truncate text-xs text-ink-3" suppressHydrationWarning>
                      {meta(doc)}
                      <span className="xl:hidden"> · {formatWhen(doc.created_at)}</span>
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
              <TableCell className="hidden text-ink-2 xl:table-cell" suppressHydrationWarning>
                {formatWhen(doc.created_at)}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <DocumentActions doc={doc} actions={actions} variant="table" />
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
            </div>
            <div className="pl-[42px]">
              <DocumentActions doc={doc} actions={actions} variant="list" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
