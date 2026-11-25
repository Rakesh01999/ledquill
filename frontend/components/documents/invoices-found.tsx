"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Missing, Money } from "@/components/shared/money";
import { StatusChip } from "@/components/shared/status-chip";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Pager } from "@/components/shared/pager";
import { useLocalPaging } from "@/components/shared/use-local-paging";
import { RowAction } from "@/components/shared/row-action";
import { useConfirmedActions } from "@/components/shared/use-confirmed-actions";
import { Archive, ExternalLink } from "lucide-react";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { invoiceLabel } from "@/lib/invoices";
import { HEAD, ROW } from "@/lib/table";
import { documentInvoicesOptions } from "@/lib/query/options";

const head = HEAD;

/** Opened from here, an invoice remembers the file it came from (its breadcrumb gains that file). */
export const fromDocument = (invoiceId: string, hash = "") => `/invoices/${invoiceId}?from=doc${hash}`;

export function InvoicesFound({
  documentId,
  status,
  archived = false,
}: {
  documentId: string;
  status: string;
  /** The file is archived: its invoices are listed, and they can only come back with the file. */
  archived?: boolean;
}) {
  const { data, isPending, error, refetch } = useQuery(documentInvoicesOptions(api, documentId, archived));
  const { pageItems, pagerProps } = useLocalPaging(data?.items ?? []);
  const actions = useConfirmedActions();

  if (isPending) return <TableSkeleton rows={2} widths={["w-32", "w-40", "w-20", "w-16"]} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (data.items.length === 0) {
    const title =
      status === "completed"
        ? "No invoices were found in this document."
        : status === "failed"
          ? "No invoices were created because processing failed."
          : "Invoices appear here when processing finishes.";
    return <EmptyState title={title} />;
  }

  return (
    <>
    {actions.dialog}
    <Table bare className="hidden lg:table">
      <TableHeader className="bg-surface-2 [&_tr]:border-line">
        <TableRow className="h-9 hover:bg-transparent">
          <TableHead className={`pl-4 ${head}`}>Invoice</TableHead>
          <TableHead className={head}>Supplier</TableHead>
          <TableHead className={`hidden xl:table-cell ${head}`}>Date</TableHead>
          <TableHead className={`hidden xl:table-cell ${head}`}>Currency</TableHead>
          <TableHead className={`text-right ${head}`}>Total</TableHead>
          <TableHead className={`pl-4 xl:pl-6 ${head}`}>Status</TableHead>
          <TableHead className={`hidden text-right xl:table-cell ${head}`}>Issues</TableHead>
          <TableHead className={`w-[148px] pr-4 text-right max-xl:w-[96px] ${head}`}>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pageItems.map((inv) => (
          <TableRow key={inv.id} className={`${ROW} border-line hover:bg-surface-2/60`}>
            <TableCell className="pl-4 font-medium">
              <Link href={fromDocument(inv.id)} className="font-mono text-link hover:underline">
                {inv.invoice_number ?? <Missing />}
              </Link>
            </TableCell>
            <TableCell className="max-w-40 truncate xl:max-w-56" title={inv.supplier_name ?? undefined}>
              {inv.supplier_name ?? <Missing />}
            </TableCell>
            <TableCell className="hidden tabular-nums xl:table-cell">{formatDate(inv.invoice_date) ?? <Missing />}</TableCell>
            <TableCell className="hidden xl:table-cell">{inv.currency ?? <Missing />}</TableCell>
            <TableCell className="text-right">
              <Money value={inv.total} />
            </TableCell>
            <TableCell className="pl-4 xl:pl-6">
              <StatusChip status={inv.status} />
            </TableCell>
            <TableCell className="hidden text-right tabular-nums xl:table-cell">
              {inv.issues.length > 0 ? inv.issues.length : <span className="text-ink-3">None</span>}
            </TableCell>
            <TableCell className="pr-4 text-right">
              <div className="-mr-2.5 flex items-center justify-end gap-0.5 max-xl:-mr-2">
                <RowAction
                  icon={ExternalLink}
                  label="Open"
                  name={`Open ${invoiceLabel(inv)}`}
                  href={fromDocument(inv.id)}
                  compact
                />
                {!archived && (
                  <RowAction
                    icon={Archive}
                    label="Archive"
                    name={`Archive ${invoiceLabel(inv)}`}
                    tone="muted"
                    compact
                    disabled={actions.isBusy("invoice", inv.id)}
                    onClick={() => actions.askArchive("invoice", inv.id, invoiceLabel(inv))}
                  />
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>

    {/* Below lg: one card per invoice, so nothing needs a sideways scroll. */}
    <ul className="divide-y divide-line lg:hidden">
      {pageItems.map((inv) => (
        <li key={inv.id} className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <Link href={fromDocument(inv.id)} className="flex-none font-mono text-[13px] font-medium text-link hover:underline">
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
              {formatDate(inv.invoice_date) ?? "No date"}
              {inv.issues.length > 0 && ` · ${inv.issues.length} ${inv.issues.length === 1 ? "issue" : "issues"}`}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <RowAction
                icon={ExternalLink}
                label="Open"
                name={`Open ${invoiceLabel(inv)}`}
                href={fromDocument(inv.id)}
                variant="outline"
              />
              {!archived && (
                <RowAction
                  icon={Archive}
                  label="Archive"
                  name={`Archive ${invoiceLabel(inv)}`}
                  tone="muted"
                  variant="outline"
                  disabled={actions.isBusy("invoice", inv.id)}
                  onClick={() => actions.askArchive("invoice", inv.id, invoiceLabel(inv))}
                />
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
    {data.items.length > 10 && <Pager {...pagerProps} />}
    {data.total > data.items.length && (
      <p className="border-t border-line px-4 py-2 text-xs text-ink-2">
        Showing the first {data.items.length} of {data.total} invoices in this file.
      </p>
    )}
    </>
  );
}
