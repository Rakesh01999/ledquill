"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pager } from "@/components/shared/pager";
import { Missing, Money } from "@/components/shared/money";
import { RefreshButton } from "@/components/shared/refresh-button";
import { SegmentedFilter } from "@/components/shared/segmented-filter";
import { StatusChip } from "@/components/shared/status-chip";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableBar } from "@/components/shared/table-bar";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Toolbar } from "@/components/shared/toolbar";
import { useConfirmedActions } from "@/components/shared/use-confirmed-actions";
import { ArchiveRestore, ExternalLink } from "lucide-react";
import { RowAction } from "@/components/shared/row-action";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import type { DocumentOut, InvoiceOut } from "@/lib/api/types";
import { formatWhen, typeTile } from "@/lib/documents";
import { formatBytes, formatDate } from "@/lib/format";
import { invoiceLabel } from "@/lib/invoices";
import { DEFAULT_PAGE_SIZE, parseSize } from "@/lib/paging";
import { documentsOptions, invoicesOptions } from "@/lib/query/options";
import { HEAD, ROW } from "@/lib/table";
import { cn } from "@/lib/utils";

type Tab = "documents" | "invoices";

export function archivedHref(tab: Tab, page: number, size: number): string {
  const q = new URLSearchParams();
  if (tab === "invoices") q.set("tab", "invoices");
  if (size !== DEFAULT_PAGE_SIZE) q.set("size", String(size));
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/archived?${s}` : "/archived";
}

type Actions = ReturnType<typeof useConfirmedActions>;

/**
 * A server that has not been updated ignores `archived=true` and returns every row. Rows that
 * carry no archive stamp mean exactly that, so they are never listed as archived.
 */
const notArchived = (rows: { archived_at?: string | null }[]) => rows.some((row) => !row.archived_at);

function DocumentRows({ items, actions }: { items: DocumentOut[]; actions: Actions }) {
  const buttons = (doc: DocumentOut, variant: "ghost" | "outline", compact: boolean) => (
    <>
      <RowAction
        icon={ExternalLink}
        label="Open"
        name={`Open ${doc.filename}`}
        href={`/documents/${doc.id}`}
        variant={variant}
        compact={compact}
      />
      <RowAction
        icon={ArchiveRestore}
        label="Restore"
        name={`Restore ${doc.filename}`}
        variant={variant}
        compact={compact}
        pending={actions.isBusy("document", doc.id)}
        onClick={() => actions.askRestore("document", doc.id, doc.filename)}
      />
    </>
  );
  return (
    <>
      <Table bare className="hidden table-fixed lg:table">
        <TableHeader className="bg-surface-2 [&_tr]:border-line">
          <TableRow className="h-9 hover:bg-transparent">
            <TableHead className={cn("w-[38%] pl-4", HEAD)}>File</TableHead>
            <TableHead className={cn("w-[124px]", HEAD)}>Status</TableHead>
            <TableHead className={cn("w-[100px] text-right", HEAD)}>Invoices</TableHead>
            <TableHead className={cn("pl-6", HEAD)}>Archived</TableHead>
            <TableHead className={cn("w-[190px] pr-4 text-right max-xl:w-[96px]", HEAD)}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((doc) => (
            <TableRow key={doc.id} className={cn(ROW, "border-line hover:bg-surface-2/60")}>
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
                      title={doc.filename}
                      className="block truncate font-medium text-ink hover:text-link hover:underline"
                    >
                      {doc.filename}
                    </Link>
                    <div className="truncate text-xs text-ink-3">{formatBytes(doc.size_bytes)}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <StatusChip status={doc.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{doc.invoice_count}</TableCell>
              <TableCell className="pl-6 text-ink-2" suppressHydrationWarning>
                {doc.archived_at ? formatWhen(doc.archived_at) : ""}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <div className="-mr-2.5 flex items-center justify-end gap-0.5 max-xl:-mr-2">{buttons(doc, "ghost", true)}</div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className="divide-y divide-line lg:hidden">
        {items.map((doc) => (
          <li key={doc.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex min-w-0 items-baseline gap-3">
              <Link
                href={`/documents/${doc.id}`}
                title={doc.filename}
                className="min-w-0 flex-1 truncate font-medium text-ink hover:text-link hover:underline"
              >
                {doc.filename}
              </Link>
              <span className="flex-none text-xs text-ink-3">{formatBytes(doc.size_bytes)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusChip status={doc.status} />
              <span className="text-xs text-ink-2" suppressHydrationWarning>
                {doc.invoice_count} {doc.invoice_count === 1 ? "invoice" : "invoices"}
                {doc.archived_at ? ` · archived ${formatWhen(doc.archived_at)}` : ""}
              </span>
              <div className="ml-auto flex items-center gap-2">{buttons(doc, "outline", false)}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function InvoiceRows({ items, actions }: { items: InvoiceOut[]; actions: Actions }) {
  const buttons = (inv: InvoiceOut, variant: "ghost" | "outline", compact: boolean) => (
    <>
      <RowAction
        icon={ExternalLink}
        label="Open"
        name={`Open ${invoiceLabel(inv)}`}
        href={`/invoices/${inv.id}`}
        variant={variant}
        compact={compact}
      />
      <RowAction
        icon={ArchiveRestore}
        label="Restore"
        name={`Restore ${invoiceLabel(inv)}`}
        variant={variant}
        compact={compact}
        pending={actions.isBusy("invoice", inv.id)}
        onClick={() => actions.askRestore("invoice", inv.id, invoiceLabel(inv))}
      />
    </>
  );
  return (
    <>
      <Table bare className="hidden lg:table">
        <TableHeader className="bg-surface-2 [&_tr]:border-line">
          <TableRow className="h-9 hover:bg-transparent">
            <TableHead className={cn("pl-4", HEAD)}>Invoice</TableHead>
            <TableHead className={HEAD}>Supplier</TableHead>
            <TableHead className={cn("hidden xl:table-cell", HEAD)}>Date</TableHead>
            <TableHead className={cn("hidden xl:table-cell", HEAD)}>Currency</TableHead>
            <TableHead className={cn("text-right", HEAD)}>Total</TableHead>
            <TableHead className={cn("pl-4 xl:pl-6", HEAD)}>Status</TableHead>
            <TableHead className={HEAD}>Archived</TableHead>
            <TableHead className={cn("w-[190px] pr-4 text-right max-xl:w-[96px]", HEAD)}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((inv) => (
            <TableRow key={inv.id} className={cn(ROW, "border-line hover:bg-surface-2/60")}>
              <TableCell className="pl-4">
                <Link
                  href={`/invoices/${inv.id}`}
                  className="font-mono text-table font-medium text-link hover:underline"
                >
                  {inv.invoice_number ?? <Missing />}
                  {!inv.invoice_number && <span className="sr-only">Invoice without a number</span>}
                </Link>
              </TableCell>
              <TableCell className="max-w-32 truncate xl:max-w-56" title={inv.supplier_name ?? undefined}>
                {inv.supplier_name ?? <Missing />}
              </TableCell>
              <TableCell className="hidden tabular-nums xl:table-cell">
                {formatDate(inv.invoice_date) ?? <Missing />}
              </TableCell>
              <TableCell className="hidden xl:table-cell">{inv.currency ?? <Missing />}</TableCell>
              <TableCell className="text-right">
                <Money value={inv.total} />
                {inv.currency && <span className="ml-1 text-xs text-ink-3 xl:hidden">{inv.currency}</span>}
              </TableCell>
              <TableCell className="pl-4 xl:pl-6">
                <StatusChip status={inv.status} />
              </TableCell>
              <TableCell className="text-ink-2" suppressHydrationWarning>
                {inv.archived_at ? formatWhen(inv.archived_at) : ""}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <div className="-mr-2.5 flex items-center justify-end gap-0.5 max-xl:-mr-2">{buttons(inv, "ghost", true)}</div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className="divide-y divide-line lg:hidden">
        {items.map((inv) => (
          <li key={inv.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-baseline gap-3">
              <Link
                href={`/invoices/${inv.id}`}
                className="flex-none font-mono text-table font-medium text-link hover:underline"
              >
                {inv.invoice_number ?? <Missing />}
                {!inv.invoice_number && <span className="sr-only">Invoice without a number</span>}
              </Link>
              <span className="min-w-0 flex-1 truncate" title={inv.supplier_name ?? undefined}>
                {inv.supplier_name ?? <Missing />}
              </span>
              <span className="flex-none text-right">
                <Money value={inv.total} />
                {inv.currency && <span className="ml-1 text-xs text-ink-3">{inv.currency}</span>}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusChip status={inv.status} />
              <span className="text-xs text-ink-2" suppressHydrationWarning>
                {inv.archived_at ? `Archived ${formatWhen(inv.archived_at)}` : ""}
              </span>
              <div className="ml-auto flex items-center gap-2">{buttons(inv, "outline", false)}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Archived documents and invoices, with the way back. Nothing here can be deleted. */
export function ArchivedView() {
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "invoices" ? "invoices" : "documents";
  const size = parseSize(searchParams.get("size") ?? undefined);
  const wanted = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(wanted) && wanted >= 1 ? wanted : 1;
  const actions = useConfirmedActions();

  const docParams = useMemo(() => ({ page, size, archived: true }), [page, size]);
  const documents = useQuery({ ...documentsOptions(api, docParams), enabled: tab === "documents" });
  const invoices = useQuery({ ...invoicesOptions(api, { page, size }, true), enabled: tab === "invoices" });
  const active = tab === "documents" ? documents : invoices;
  const data = active.data;

  // Restoring the last row of the last page leaves that page empty: step back to the new last one.
  useEffect(() => {
    if (!data || data.items.length > 0 || data.total === 0 || page <= 1 || active.isPlaceholderData) return;
    const last = Math.max(1, Math.ceil(data.total / size));
    window.history.replaceState(null, "", archivedHref(tab, Math.min(page, last), size));
  }, [data, page, size, tab, active.isPlaceholderData]);

  const unsupported = Boolean(data && notArchived(data.items));
  const noun = tab === "documents" ? "document" : "invoice";

  return (
    <div className="flex flex-col gap-section">
      <Toolbar>
        <div className="flex">
          <SegmentedFilter
            label="Archived items"
            segments={[
              { key: "documents", label: "Documents", href: archivedHref("documents", 1, size), active: tab === "documents" },
              { key: "invoices", label: "Invoices", href: archivedHref("invoices", 1, size), active: tab === "invoices" },
            ]}
          />
        </div>
      </Toolbar>

      <div className="overflow-clip rounded-lg border border-line bg-surface">
        <TableBar
          refresh={
            <RefreshButton
              label={`Refresh archived ${noun}s`}
              queryKeys={[[tab === "documents" ? "documents" : "invoices", "list"]]}
            />
          }
        >
          {data && !unsupported ? `${data.total} archived ${data.total === 1 ? noun : `${noun}s`}` : null}
        </TableBar>
        <div aria-busy={active.isFetching} className={cn(active.isPlaceholderData && "opacity-60 transition-opacity")}>
          {active.isPending ? (
            <TableSkeleton rows={6} widths={["w-56", "w-24", "w-16", "w-24"]} />
          ) : active.error && !data ? (
            <ErrorState error={active.error} onRetry={() => void active.refetch()} />
          ) : unsupported ? (
            <EmptyState title="Archiving is not available on this server yet. Update the API, then reload this page." />
          ) : data && data.items.length === 0 ? (
            <EmptyState
              title={
                tab === "documents"
                  ? "No archived documents. A document you archive appears here, and can be restored."
                  : "No archived invoices. An invoice you archive appears here, and can be restored."
              }
            />
          ) : tab === "documents" && documents.data ? (
            <DocumentRows items={documents.data.items} actions={actions} />
          ) : tab === "invoices" && invoices.data ? (
            <InvoiceRows items={invoices.data.items} actions={actions} />
          ) : null}
        </div>
        {data && !unsupported && (
          <Pager
            page={page}
            pageSize={size}
            total={data.total}
            hrefFor={(target) => archivedHref(tab, target, size)}
            sizeHref={(rows) => archivedHref(tab, 1, rows)}
          />
        )}
      </div>
      {actions.dialog}
    </div>
  );
}
