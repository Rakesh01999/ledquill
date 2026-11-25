"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { CountBadge } from "@/components/shared/count-badge";
import { Missing, Money } from "@/components/shared/money";
import { Pager } from "@/components/shared/pager";
import { useHoverPrefetch } from "@/components/shared/use-hover-prefetch";
import { useLocalPaging } from "@/components/shared/use-local-paging";
import { rowNavKeyDown } from "@/components/shared/row-nav";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { formatAge } from "@/lib/documents";
import { ruleTitle, topIssue } from "@/lib/invoices";
import { HEAD, ROW } from "@/lib/table";
import { prefetchInvoice } from "@/lib/query/prefetch";
import { QUEUE_LIMIT, queueOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";

const head = HEAD;

/** Invoices that need a decision, worst first. Opening one enters queue mode (Next and Approve). */
export function ReviewView() {
  const queryClient = useQueryClient();
  const { data, error, isPending, refetch } = useQuery(queueOptions(api));
  const total = data?.total ?? 0;
  const hoverPrefetch = useHoverPrefetch();
  const { pageItems, pagerProps } = useLocalPaging(data?.items ?? []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Needs review</h2>
        {data && total > 0 && <CountBadge count={total} />}
        <span className="text-xs text-ink-2">Sorted by severity: errors, then warnings, then low confidence; oldest first.</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div>
          {isPending ? (
            <TableSkeleton rows={10} widths={["w-28", "w-44", "w-20", "w-72", "w-10"]} />
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
            <>
            <Table className="hidden lg:table" onKeyDown={rowNavKeyDown}>
              <TableHeader className="bg-surface-2 [&_tr]:border-line">
                <TableRow className="h-9 hover:bg-transparent">
                  <TableHead className={cn("pl-4", head)}>Invoice</TableHead>
                  <TableHead className={head}>Supplier</TableHead>
                  <TableHead className={head}>Currency</TableHead>
                  <TableHead className={cn("text-right", head)}>Total</TableHead>
                  <TableHead className={head}>Top issue</TableHead>
                  <TableHead className={head}>Age</TableHead>
                  <TableHead className={cn("pr-4 text-right", head)}>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((inv) => {
                  const issue = topIssue(inv);
                  return (
                    <TableRow
                      key={inv.id}
                      className={cn(ROW, "border-line hover:bg-surface-2/60")}
                      {...hoverPrefetch(() => prefetchInvoice(queryClient, inv.id))}
                    >
                      <TableCell className="pl-4">
                        <Link
                          href={`/invoices/${inv.id}?queue=1`}
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
                      <TableCell>{inv.currency ?? <Missing />}</TableCell>
                      <TableCell className="text-right">
                        <Money value={inv.total} />
                      </TableCell>
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
                      <TableCell className="text-ink-2 tabular-nums" suppressHydrationWarning>
                        {formatAge(inv.created_at)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        {/* The invoice number is the same link, so this one stays out of the tab order. */}
                        <Button asChild variant="ghost" size="sm" className="text-link">
                          <Link href={`/invoices/${inv.id}?queue=1`} tabIndex={-1} aria-hidden="true">
                            Review
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <ul className="divide-y divide-line lg:hidden">
              {pageItems.map((inv) => {
                const issue = topIssue(inv);
                return (
                  <li key={inv.id}>
                    <Link
                      href={`/invoices/${inv.id}?queue=1`}
                      onFocus={() => prefetchInvoice(queryClient, inv.id)}
                      className="flex flex-col gap-1.5 px-4 py-3 hover:bg-surface-2/60"
                    >
                      <span className="flex items-baseline gap-3">
                        <span className="flex-none font-mono text-[13px] font-medium text-link">
                          {inv.invoice_number ?? <Missing />}
                          {!inv.invoice_number && <span className="sr-only">Invoice without a number</span>}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink" title={inv.supplier_name ?? undefined}>
                          {inv.supplier_name ?? <Missing />}
                        </span>
                        <span className="flex-none text-right text-ink">
                          <Money value={inv.total} />
                          {inv.currency && <span className="ml-1 text-xs text-ink-3">{inv.currency}</span>}
                        </span>
                      </span>
                      <span className="flex items-start gap-2 text-[13px]">
                        {issue ? (
                          <>
                            {issue.severity === "error" ? (
                              <CircleAlert className="mt-0.5 size-4 flex-none text-danger" aria-label="Error" />
                            ) : (
                              <TriangleAlert className="mt-0.5 size-4 flex-none text-warn" aria-label="Warning" />
                            )}
                            <span className="line-clamp-2 min-w-0 flex-1">
                              <span className="font-medium text-ink">{ruleTitle(issue.rule_id)}.</span>{" "}
                              <span className="text-ink-2">{issue.message}</span>
                              {inv.issues.length > 1 && (
                                <span className="ml-1 text-xs text-ink-3">+{inv.issues.length - 1}</span>
                              )}
                            </span>
                          </>
                        ) : (
                          <span className="flex-1 text-ink-3">None</span>
                        )}
                        <span className="flex-none text-xs text-ink-3 tabular-nums" suppressHydrationWarning>
                          {formatAge(inv.created_at)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </div>
        {data && data.items.length > 0 && <Pager {...pagerProps} />}
        {data && data.total > QUEUE_LIMIT && (
          <p className="border-t border-line px-4 py-2 text-xs text-ink-2">
            Showing the first {QUEUE_LIMIT} of {data.total}. Approve or fix some to see the rest.
          </p>
        )}
      </div>
    </div>
  );
}
