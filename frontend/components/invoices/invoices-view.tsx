"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { ShallowLink } from "@/components/shared/shallow-link";
import { Pager } from "@/components/shared/pager";
import { RefreshButton } from "@/components/shared/refresh-button";
import { TableBar } from "@/components/shared/table-bar";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { api } from "@/lib/api/client";
import { FALLBACK_NOTES, invoicesHref, isSearchOnly, parseInvoiceParams } from "@/lib/invoices";
import { invoicesOptions, searchOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";
import { Toolbar } from "@/components/shared/toolbar";
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
  // Counted from the rows the API returned: how many matched the text itself, not only the meaning.
  const shown = search.data?.items.length ?? 0;
  const exact = search.data?.items.filter((h) => h.matched_by.includes("keyword")).length ?? 0;
  const filtered = Boolean(
    params.q || params.status || params.supplier || params.currency || params.date_from || params.date_to || params.min_total || params.max_total,
  );

  const count = searchMode ? rows?.length : list.data?.total;

  // Archiving the last row of the last page leaves that page empty: step back to the new last one.
  useEffect(() => {
    const data = list.data;
    if (searchMode || !data || data.items.length > 0 || data.total === 0 || params.page <= 1 || list.isPlaceholderData) {
      return;
    }
    const last = Math.max(1, Math.ceil(data.total / params.size));
    window.history.replaceState(null, "", invoicesHref({ ...params, page: Math.min(params.page, last) }));
  }, [list.data, list.isPlaceholderData, params, searchMode]);

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <InvoiceFilters params={params} />
      </Toolbar>

      <div className="flex min-h-5 flex-col gap-1 text-[13px] text-ink-2" role="status">
        {searchMode && search.data && (
          <>
            {shown > 0 && (
              <p>
                {exact === shown
                  ? `${shown} ${shown === 1 ? "match" : "matches"} for “${params.q}”.`
                  : `${shown} closest ${shown === 1 ? "match" : "matches"} for “${params.q}” (${exact} exact).`}
              </p>
            )}
            {exact < shown && <p>Rows marked “Similar meaning” are close in meaning to your words, not exact text matches.</p>}
            {fallback && <p className="text-ink">{FALLBACK_NOTES[fallback] ?? "Semantic search is not available."}</p>}
          </>
        )}
        {!searchMode && params.q && list.data && (
          <p>Filters are active, so this uses keyword matching on “{params.q}” instead of ranked search.</p>
        )}
      </div>

      <div className="overflow-clip rounded-lg border border-line bg-surface">
        <TableBar
          refresh={
            <RefreshButton
              label="Refresh invoices"
              queryKeys={[
                ["invoices", "list"],
                ["invoices", "search"],
              ]}
            />
          }
        >
          {count === undefined ? null : `${count} ${count === 1 ? "invoice" : "invoices"}`}
        </TableBar>
        <div aria-busy={active.isFetching} className={cn(active.isPlaceholderData && "opacity-60 transition-opacity")}>
          {active.isPending && active.fetchStatus !== "idle" ? (
            <TableSkeleton rows={10} widths={SKELETON_WIDTHS} />
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
              action={
                searchMode ? (
                  <ShallowLink
                    href={invoicesHref({ ...params, q: undefined, page: 1 })}
                    className="text-[13px] font-medium text-link hover:underline"
                  >
                    Clear search
                  </ShallowLink>
                ) : filtered ? (
                  <ShallowLink
                    href={invoicesHref({ page: 1, size: params.size })}
                    className="text-[13px] font-medium text-link hover:underline"
                  >
                    Clear filters
                  </ShallowLink>
                ) : undefined
              }
            />
          ) : rows ? (
            <InvoicesTable rows={rows} showMatch={searchMode} />
          ) : null}
        </div>
        {!searchMode && list.data && (
          <Pager
            page={params.page}
            pageSize={params.size}
            total={list.data.total}
            hrefFor={(page) => invoicesHref({ ...params, page })}
            sizeHref={(size) => invoicesHref({ ...params, size, page: 1 })}
          />
        )}
      </div>
    </div>
  );
}
