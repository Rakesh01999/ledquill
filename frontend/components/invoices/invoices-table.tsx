"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Missing, Money } from "@/components/shared/money";
import { StatusChip } from "@/components/shared/status-chip";
import { useHoverPrefetch } from "@/components/shared/use-hover-prefetch";
import { rowNavKeyDown } from "@/components/shared/row-nav";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InvoiceOut } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { HEAD, ROW } from "@/lib/table";
import { prefetchInvoice } from "@/lib/query/prefetch";
import { cn } from "@/lib/utils";

const head = HEAD;
const MATCH_LABEL: Record<string, string> = { keyword: "Exact text", semantic: "Similar meaning" };

export type InvoiceRow = { invoice: InvoiceOut; matchedBy?: string[] };

/** Invoices as a table. In search results a "Matched by" column explains why each row is there. */
export function InvoicesTable({ rows, showMatch = false }: { rows: InvoiceRow[]; showMatch?: boolean }) {
  const queryClient = useQueryClient();
  const hoverPrefetch = useHoverPrefetch();
  return (
    <Table className="min-w-[900px] lg:min-w-0" onKeyDown={rowNavKeyDown}>
      <TableHeader className="bg-surface-2 [&_tr]:border-line">
        <TableRow className="h-9 hover:bg-transparent">
          <TableHead className={cn("pl-4", head)}>Invoice</TableHead>
          <TableHead className={head}>Supplier</TableHead>
          <TableHead className={head}>Date</TableHead>
          <TableHead className={head}>Currency</TableHead>
          <TableHead className={cn("text-right", head)}>Total</TableHead>
          <TableHead className={cn("pl-6", head)}>Status</TableHead>
          <TableHead className={cn("text-right", head)}>Issues</TableHead>
          {showMatch && <TableHead className={head}>Matched by</TableHead>}
          <TableHead className={cn("pr-4 text-right", head)}>Action</TableHead>
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
            </TableCell>
            <TableCell className="max-w-56 truncate" title={inv.supplier_name ?? undefined}>
              {inv.supplier_name ?? <Missing />}
            </TableCell>
            <TableCell className="tabular-nums">{formatDate(inv.invoice_date) ?? <Missing />}</TableCell>
            <TableCell>{inv.currency ?? <Missing />}</TableCell>
            <TableCell className="text-right">
              <Money value={inv.total} />
            </TableCell>
            <TableCell className="pl-6">
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
              <TableCell className="text-ink-2">
                {matchedBy?.map((m) => MATCH_LABEL[m] ?? m).join(" + ") || "—"}
              </TableCell>
            )}
            <TableCell className="pr-4 text-right">
              {/* The invoice number is the same link, so this one stays out of the tab order. */}
              <Button asChild variant="ghost" size="sm" className="text-link">
                <Link href={`/invoices/${inv.id}`} tabIndex={-1} aria-hidden="true">
                  Open
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
