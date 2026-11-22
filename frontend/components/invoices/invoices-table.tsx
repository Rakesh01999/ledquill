"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Missing, Money } from "@/components/shared/money";
import { StatusChip } from "@/components/shared/status-chip";
import { rowNavKeyDown } from "@/components/shared/row-nav";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InvoiceOut } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { prefetchInvoice } from "@/lib/query/prefetch";
import { cn } from "@/lib/utils";

const head = "text-xs font-medium text-ink-2";
const MATCH_LABEL: Record<string, string> = { keyword: "Keyword", semantic: "Meaning" };

export type InvoiceRow = { invoice: InvoiceOut; matchedBy?: string[] };

/** Invoices as a table. In search results a "Matched by" column explains why each row is there. */
export function InvoicesTable({ rows, showMatch = false }: { rows: InvoiceRow[]; showMatch?: boolean }) {
  const queryClient = useQueryClient();
  return (
    <Table className="min-w-[860px]" onKeyDown={rowNavKeyDown}>
      <TableHeader className="sticky top-0 z-10 bg-surface-2 [&_tr]:border-line">
        <TableRow className="h-9 hover:bg-transparent">
          <TableHead className={cn("pl-4", head)}>Invoice</TableHead>
          <TableHead className={head}>Supplier</TableHead>
          <TableHead className={head}>Date</TableHead>
          <TableHead className={head}>Currency</TableHead>
          <TableHead className={cn("text-right", head)}>Total</TableHead>
          <TableHead className={head}>Status</TableHead>
          <TableHead className={cn("text-right", head, !showMatch && "pr-4")}>Issues</TableHead>
          {showMatch && <TableHead className={cn("pr-4", head)}>Matched by</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ invoice: inv, matchedBy }) => (
          <TableRow key={inv.id} className="h-10 border-line hover:bg-surface-2/60">
            <TableCell className="pl-4">
              <Link
                href={`/invoices/${inv.id}`}
                data-row-link
                onMouseEnter={() => prefetchInvoice(queryClient, inv.id)}
                onFocus={() => prefetchInvoice(queryClient, inv.id)}
                className="font-mono text-[13px] font-medium text-link hover:underline"
              >
                {inv.invoice_number ?? <Missing />}
                {!inv.invoice_number && <span className="sr-only">Invoice without a number</span>}
              </Link>
            </TableCell>
            <TableCell className="max-w-56 truncate">{inv.supplier_name ?? <Missing />}</TableCell>
            <TableCell className="tabular-nums">{formatDate(inv.invoice_date) ?? <Missing />}</TableCell>
            <TableCell>{inv.currency ?? <Missing />}</TableCell>
            <TableCell className="text-right">
              <Money value={inv.total} />
            </TableCell>
            <TableCell>
              <StatusChip status={inv.status} />
            </TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                !showMatch && "pr-4",
                inv.issues.length > 0 ? "font-medium text-warn" : "text-ink-3",
              )}
            >
              {inv.issues.length > 0 ? inv.issues.length : "None"}
            </TableCell>
            {showMatch && (
              <TableCell className="pr-4 text-ink-2">
                {matchedBy?.map((m) => MATCH_LABEL[m] ?? m).join(" and ") || "—"}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
