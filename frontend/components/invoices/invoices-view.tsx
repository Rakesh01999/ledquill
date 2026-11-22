"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Pager } from "@/components/shared/pager";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { api } from "@/lib/api/client";
import { FALLBACK_NOTES, invoicesHref, isSearchOnly, parseInvoiceParams } from "@/lib/invoices";
import { PAGE_SIZE, SEARCH_LIMIT, invoicesOptions, searchOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";
import { InvoiceFilters } from "./invoice-filters";
import { InvoicesTable, type InvoiceRow } from "./invoices-table";

const SKELETON_WIDTHS = ["w-28", "w-44", "w-20", "w-10", "w-20", "w-24", "w-8"];

/**
 * Invoices with filters. A query on its own uses ranked hybrid search (/search): one list, no
 * pagination. Once any filter is combined with a query, it falls back to the keyword
 * filters of /invoices, which paginate.
 */
export function InvoicesView() {
  const searchParams = useSearchParams();
  const params = useMemo(() => parseInvoiceParams(searchParams), [searchParams]);
  const searchMode = isSearchOnly(params);

  const list = useQuery({ ...invoicesOptions(api, params), enabled: !searchMode });
  const search = useQuery({ ...searchOptions(api, params.q ?? ""), enabled: searchMode });
  const active = searchMode ? search : list;

  const rows: InvoiceRow[] | undefined = searchMode
    ? search.data?.items.map((h) => ({ invoice: h.invoice, matchedBy: h.matched_by }))
    : list.data?.items.map((invoice) => ({ invoice }));
  const fallback = searchMode ? search.data?.fallback_reason : null;
  const filtered = Boolean(
    params.q || params.status || params.supplier || params.currency || params.date_from || params.date_to || params.min_total || params.max_total,
  );

  return (
    <div className="flex h-full min-h-[560px] flex-col gap-4">
      <InvoiceFilters params={params} />

      <div className="flex min-h-5 flex-col gap-1 text-[13px] text-ink-2" role="status">
        {searchMode && search.data && (
          <>
            <p>
              {search.data.total} {search.data.total === 1 ? "result" : "results"} for “{params.q}”. Ranked results
              ({search.data.mode_used} search), no pagination. Showing up to {SEARCH_LIMIT}.
            </p>
            {search.data.items.some((h) => !h.matched_by.includes("keyword")) && (
              <p>Rows matched by meaning only are the closest invoices to your words, not exact matches.</p>
            )}
            {fallback && <p className="text-ink">{FALLBACK_NOTES[fallback] ?? "Semantic search is not available."}</p>}
          </>
        )}
        {!searchMode && params.q && list.data && (
          <p>Filters are active, so this uses keyword matching on “{params.q}” instead of ranked search.</p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div
          aria-busy={active.isFetching}
          className={cn(
            "min-h-0 flex-1 overflow-auto [&_[data-slot=table-container]]:overflow-visible",
            active.isPlaceholderData && "opacity-60 transition-opacity",
          )}
        >
          {active.isPending && active.fetchStatus !== "idle" ? (
            <TableSkeleton rows={8} widths={SKELETON_WIDTHS} />
          ) : active.error && !rows ? (
            <ErrorState error={active.error} onRetry={() => void active.refetch()} />
          ) : rows && rows.length === 0 ? (
            <EmptyState
              title={
                searchMode
                  ? `No invoices matched “${params.q}”.`
                  : filtered
                    ? "No invoices match these filters."
                    : "No invoices yet. Upload documents to create them."
              }
            />
          ) : rows ? (
            <InvoicesTable rows={rows} showMatch={searchMode} />
          ) : null}
        </div>
        {!searchMode && list.data && (
          <Pager
            page={params.page}
            pageSize={PAGE_SIZE}
            total={list.data.total}
            hrefFor={(page) => invoicesHref({ ...params, page })}
          />
        )}
      </div>
    </div>
  );
}
