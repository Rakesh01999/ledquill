"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Missing, Money } from "@/components/shared/money";
import { StatusChip } from "@/components/shared/status-chip";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Pager } from "@/components/shared/pager";
import { useLocalPaging } from "@/components/shared/use-local-paging";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { HEAD, ROW } from "@/lib/table";
import { documentInvoicesOptions } from "@/lib/query/options";

const head = HEAD;

export function InvoicesFound({ documentId, status }: { documentId: string; status: string }) {
  const { data, isPending, error, refetch } = useQuery(documentInvoicesOptions(api, documentId));
  const { pageItems, pagerProps } = useLocalPaging(data?.items ?? []);

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
    <Table className="min-w-[720px]">
      <TableHeader className="bg-surface-2 [&_tr]:border-line">
        <TableRow className="h-9 hover:bg-transparent">
          <TableHead className={`pl-4 ${head}`}>Invoice</TableHead>
          <TableHead className={head}>Supplier</TableHead>
          <TableHead className={head}>Date</TableHead>
          <TableHead className={head}>Currency</TableHead>
          <TableHead className={`text-right ${head}`}>Total</TableHead>
          <TableHead className={`pl-6 ${head}`}>Status</TableHead>
          <TableHead className={`text-right ${head}`}>Issues</TableHead>
          <TableHead className={`pr-4 text-right ${head}`}>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pageItems.map((inv) => (
          <TableRow key={inv.id} className={`${ROW} border-line hover:bg-surface-2/60`}>
            <TableCell className="pl-4 font-medium">
              <Link href={`/invoices/${inv.id}`} className="font-mono text-link hover:underline">
                {inv.invoice_number ?? <Missing />}
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
            <TableCell className="text-right tabular-nums">
              {inv.issues.length > 0 ? inv.issues.length : <span className="text-ink-3">None</span>}
            </TableCell>
            <TableCell className="pr-4 text-right">
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
    {data.items.length > 10 && <Pager {...pagerProps} />}
    {data.total > data.items.length && (
      <p className="border-t border-line px-4 py-2 text-xs text-ink-2">
        Showing the first {data.items.length} of {data.total} invoices in this file.
      </p>
    )}
    </>
  );
}
