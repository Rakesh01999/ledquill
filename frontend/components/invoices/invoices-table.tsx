"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ExternalLink } from "lucide-react";
import { Missing, Money } from "@/components/shared/money";
import { RowAction } from "@/components/shared/row-action";
import { StatusChip } from "@/components/shared/status-chip";
import { useHoverPrefetch } from "@/components/shared/use-hover-prefetch";
import { useConfirmedActions } from "@/components/shared/use-confirmed-actions";
import { rowNavKeyDown } from "@/components/shared/row-nav";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InvoiceOut } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { invoiceLabel } from "@/lib/invoices";
import { HEAD, ROW } from "@/lib/table";
import { prefetchInvoice } from "@/lib/query/prefetch";
import { cn } from "@/lib/utils";

const head = HEAD;
const MATCH_LABEL: Record<string, string> = { keyword: "Exact text", semantic: "Similar meaning" };

export type InvoiceRow = { invoice: InvoiceOut; matchedBy?: string[] };

const matchText = (matchedBy?: string[]) => matchedBy?.map((m) => MATCH_LABEL[m] ?? m).join(" + ") || "—";

/**
 * Invoices as a table from lg up (no scroll wrapper, so its header can stick to the page header)
 * and as one card per invoice below. Between lg and xl the Date and Currency columns fold away:
 * the currency moves next to the total. In search results a "Matched by" column explains why each
 * row is there.
 */
export function InvoicesTable({ rows, showMatch = false }: { rows: InvoiceRow[]; showMatch?: boolean }) {
  const queryClient = useQueryClient();
  const hoverPrefetch = useHoverPrefetch();
  const actions = useConfirmedActions();
  return (
    <>
      {actions.dialog}
      <Table bare className="hidden lg:table" onKeyDown={rowNavKeyDown}>
        <TableHeader className="bg-surface-2 [&_tr]:border-line">
          <TableRow className="h-9 hover:bg-transparent">
            <TableHead className={cn("pl-4", head)}>Invoice</TableHead>
            <TableHead className={head}>Supplier</TableHead>
            <TableHead className={cn("hidden xl:table-cell", head)}>Date</TableHead>
            <TableHead className={cn("hidden xl:table-cell", head)}>Currency</TableHead>
            <TableHead className={cn("text-right", head)}>Total</TableHead>
            <TableHead className={cn("pl-4 xl:pl-6", head)}>Status</TableHead>
            <TableHead className={cn("text-right", head)}>Issues</TableHead>
            {showMatch && <TableHead className={cn("hidden xl:table-cell", head)}>Matched by</TableHead>}
            <TableHead className={cn("w-[148px] pr-4 text-right max-xl:w-[96px]", head)}>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ invoice: inv, matchedBy }) => (
            <TableRow
              key={inv.id}
              className={cn(ROW, "border-line hover:bg-surface-2/60")}
              {...hoverPrefetch(() => prefetchInvoice(queryClient, inv.id))}
            >
              <TableCell className="pl-4">
                <Link
                  href={`/invoices/${inv.id}`}
                  data-row-link
                  onFocus={() => prefetchInvoice(queryClient, inv.id)}
                  className="font-mono text-[13px] font-medium text-link hover:underline"
                >
                  {inv.invoice_number ?? <Missing />}
                  {!inv.invoice_number && <span className="sr-only">Invoice without a number</span>}
                </Link>
                {showMatch && <div className="text-xs text-ink-3 xl:hidden">{matchText(matchedBy)}</div>}
              </TableCell>
              <TableCell className="max-w-40 truncate xl:max-w-56" title={inv.supplier_name ?? undefined}>
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
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  inv.issues.length > 0 ? "font-medium text-warn" : "text-ink-3",
                )}
              >
                {inv.issues.length > 0 ? inv.issues.length : "None"}
              </TableCell>
              {showMatch && (
                <TableCell className="hidden text-ink-2 xl:table-cell">{matchText(matchedBy)}</TableCell>
              )}
              <TableCell className="pr-4 text-right">
                <div className="-mr-2.5 flex items-center justify-end gap-0.5 max-xl:-mr-2">
                  {/* The invoice number is the same link, so Open stays out of the tab order here. */}
                  <RowAction
                    icon={ExternalLink}
                    label="Open"
                    name={`Open ${invoiceLabel(inv)}`}
                    href={`/invoices/${inv.id}`}
                    compact
                    decorative
                  />
                  <RowAction
                    icon={Archive}
                    label="Archive"
                    name={`Archive ${invoiceLabel(inv)}`}
                    tone="muted"
                    compact
                    disabled={actions.isBusy("invoice", inv.id)}
                    onClick={() => actions.askArchive("invoice", inv.id, invoiceLabel(inv))}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className="divide-y divide-line lg:hidden">
        {rows.map(({ invoice: inv, matchedBy }) => (
          <li key={inv.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-baseline gap-3">
              <Link
                href={`/invoices/${inv.id}`}
                onFocus={() => prefetchInvoice(queryClient, inv.id)}
                className="flex-none font-mono text-[13px] font-medium text-link hover:underline"
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
                {formatDate(inv.invoice_date) ?? "No date"}
                {inv.issues.length > 0 && ` · ${inv.issues.length} ${inv.issues.length === 1 ? "issue" : "issues"}`}
                {showMatch && ` · ${matchText(matchedBy)}`}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <RowAction
                  icon={ExternalLink}
                  label="Open"
                  name={`Open ${invoiceLabel(inv)}`}
                  href={`/invoices/${inv.id}`}
                  variant="outline"
                />
                <RowAction
                  icon={Archive}
                  label="Archive"
                  name={`Archive ${invoiceLabel(inv)}`}
                  tone="muted"
                  variant="outline"
                  disabled={actions.isBusy("invoice", inv.id)}
                  onClick={() => actions.askArchive("invoice", inv.id, invoiceLabel(inv))}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
