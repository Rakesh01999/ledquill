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
import { describeError } from "@/lib/api/problem";
import { ApiProblem } from "@/lib/api/problem";
import type { DocumentList } from "@/lib/api/types";
import { isActive, listHref, parseListParams } from "@/lib/documents";
import { documentsOptions } from "@/lib/query/options";
import { useBackoffInterval } from "@/lib/query/polling";
import { cn } from "@/lib/utils";
import { DocumentsTable } from "./documents-table";
import { Toolbar } from "@/components/shared/toolbar";
import { DocumentChips, StatusFilter } from "./status-filter";
import { UploadSection } from "./upload-section";

const anyActive = (data: DocumentList) => data.items.some(isActive);
const signature = (data: DocumentList) =>
  data.items.map((d) => `${d.id}:${d.status}:${d.progress}:${d.current_stage ?? ""}`).join("|");

export function DocumentsView() {
  const searchParams = useSearchParams();
  const params = useMemo(() => parseListParams(searchParams), [searchParams]);
  const refetchInterval = useBackoffInterval(anyActive, signature);
  const query = useQuery({ ...documentsOptions(api, params), refetchInterval });
  const { data, error, isPending, isFetching, isPlaceholderData } = query;

  const live = data ? anyActive(data) : false;
  const paused = error instanceof ApiProblem && error.status === 429 && data;
  const filtered = Boolean(params.status || params.file_type);

  // Archiving the last row of the last page leaves that page empty: step back to the new last one.
  useEffect(() => {
    if (!data || data.items.length > 0 || data.total === 0 || params.page <= 1 || isPlaceholderData) return;
    const last = Math.max(1, Math.ceil(data.total / params.size));
    window.history.replaceState(null, "", listHref({ ...params, page: Math.min(params.page, last) }));
  }, [data, params, isPlaceholderData]);

  return (
    <div className="flex flex-col gap-5">
      <UploadSection />

      <Toolbar>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <StatusFilter params={params} />
          </div>
          <span role="status" className="text-xs text-ink-3">
            {paused
              ? `Live updates paused. ${describeError(error).message}`
              : live
                ? "Updating live"
                : ""}
          </span>
        </div>
        <DocumentChips params={params} />
      </Toolbar>

      <div className="overflow-clip rounded-lg border border-line bg-surface">
        <TableBar refresh={<RefreshButton label="Refresh documents" queryKeys={[["documents", "list"]]} />}>
          {data ? `${data.total} ${data.total === 1 ? "document" : "documents"}` : null}
        </TableBar>
        <div aria-busy={isFetching} className={cn(isPlaceholderData && "opacity-60 transition-opacity")}>
          {isPending ? (
            <TableSkeleton rows={10} widths={["w-56", "w-24", "w-40", "w-20"]} />
          ) : error && !data ? (
            <ErrorState error={error} onRetry={() => void query.refetch()} />
          ) : data && data.items.length === 0 ? (
            <EmptyState
              title={filtered ? "No documents match these filters." : "No documents yet. Drop files to start."}
              action={
                filtered ? (
                  <ShallowLink href={listHref({ page: 1, size: params.size })} className="text-[13px] font-medium text-link hover:underline">
                    Clear filters
                  </ShallowLink>
                ) : undefined
              }
            />
          ) : data ? (
            <DocumentsTable items={data.items} />
          ) : null}
        </div>
        {data && (
          <Pager
            page={params.page}
            pageSize={params.size}
            total={data.total}
            hrefFor={(page) => listHref({ ...params, page })}
            sizeHref={(size) => listHref({ ...params, size, page: 1 })}
          />
        )}
      </div>
    </div>
  );
}
