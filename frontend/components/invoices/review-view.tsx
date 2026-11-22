"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { CountBadge } from "@/components/shared/count-badge";
import { Missing, Money } from "@/components/shared/money";
import { rowNavKeyDown } from "@/components/shared/row-nav";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { formatAge } from "@/lib/documents";
import { ruleTitle, topIssue } from "@/lib/invoices";
import { prefetchInvoice } from "@/lib/query/prefetch";
import { QUEUE_LIMIT, queueOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";

const head = "text-xs font-medium text-ink-2";

/** Invoices that need a decision, worst first. Opening one enters queue mode (Next and Approve). */
export function ReviewView() {
  const queryClient = useQueryClient();
  const { data, error, isPending, refetch } = useQuery(queueOptions(api));
  const total = data?.total ?? 0;

  return (
    <div className="flex h-full min-h-[480px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Needs review</h2>
        {data && total > 0 && <CountBadge count={total} />}
        <span className="text-xs text-ink-2">Sorted by severity: errors, then warnings, then low confidence; oldest first.</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div className="min-h-0 flex-1 scroll-pt-10 scroll-pb-2 overflow-auto [&_[data-slot=table-container]]:overflow-visible">
          {isPending ? (
            <TableSkeleton rows={8} widths={["w-28", "w-44", "w-20", "w-72", "w-10"]} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : data.items.length === 0 ? (
            <EmptyState
              title="Nothing needs review."
              action={
                <Link href="/documents" className="text-[13px] font-medium text-link hover:underline">
                  Go to documents
                </Link>
              }
            />
          ) : (
            <Table className="min-w-[860px]" onKeyDown={rowNavKeyDown}>
              <TableHeader className="sticky top-0 z-10 bg-surface-2 [&_tr]:border-line">
                <TableRow className="h-9 hover:bg-transparent">
                  <TableHead className={cn("pl-4", head)}>Invoice</TableHead>
                  <TableHead className={head}>Supplier</TableHead>
                  <TableHead className={cn("text-right", head)}>Total</TableHead>
                  <TableHead className={head}>Currency</TableHead>
                  <TableHead className={head}>Top issue</TableHead>
                  <TableHead className={cn("pr-4 text-right", head)}>Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((inv) => {
                  const issue = topIssue(inv);
                  return (
                    <TableRow key={inv.id} className="h-11 border-line hover:bg-surface-2/60">
                      <TableCell className="pl-4">
                        <Link
                          href={`/invoices/${inv.id}?queue=1`}
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
                      <TableCell className="text-right">
                        <Money value={inv.total} />
                      </TableCell>
                      <TableCell>{inv.currency ?? <Missing />}</TableCell>
                      <TableCell className="max-w-md">
                        {issue ? (
                          <span className="flex items-center gap-2">
                            {issue.severity === "error" ? (
                              <CircleAlert className="size-4 flex-none text-danger" aria-label="Error" />
                            ) : (
                              <TriangleAlert className="size-4 flex-none text-warn" aria-label="Warning" />
                            )}
                            <span className="truncate" title={issue.message}>
                              <span className="font-medium">{ruleTitle(issue.rule_id)}.</span>{" "}
                              <span className="text-ink-2">{issue.message}</span>
                            </span>
                            {inv.issues.length > 1 && (
                              <span className="flex-none text-xs text-ink-3">+{inv.issues.length - 1}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-3">None</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-right text-ink-2 tabular-nums" suppressHydrationWarning>
                        {formatAge(inv.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        {data && data.total > QUEUE_LIMIT && (
          <p className="border-t border-line px-4 py-2 text-xs text-ink-2">
            Showing the first {QUEUE_LIMIT} of {data.total}. Approve or fix some to see the rest.
          </p>
        )}
      </div>
    </div>
  );
}
