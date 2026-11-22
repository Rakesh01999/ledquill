"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Pager } from "@/components/shared/pager";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { api } from "@/lib/api/client";
import { describeError } from "@/lib/api/problem";
import { ApiProblem } from "@/lib/api/problem";
import type { DocumentList } from "@/lib/api/types";
import { DOC_ROW, isActive, listHref, parseListParams } from "@/lib/documents";
import { PAGE_SIZE, documentsOptions } from "@/lib/query/options";
import { useBackoffInterval } from "@/lib/query/polling";
import { cn } from "@/lib/utils";
import { DocumentsTable } from "./documents-table";
import { StatusFilter } from "./status-filter";
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

  return (
    <div className="flex h-full min-h-[560px] flex-col gap-5">
      <UploadSection />

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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div
          aria-busy={isFetching}
          className={cn(
            "min-h-0 flex-1 overflow-auto [&_[data-slot=table-container]]:overflow-visible",
            isPlaceholderData && "opacity-60 transition-opacity",
          )}
        >
          {isPending ? (
            <TableSkeleton rows={8} rowClass={DOC_ROW} widths={["w-56", "w-24", "w-40", "w-10", "w-10", "w-20"]} />
          ) : error && !data ? (
            <ErrorState error={error} onRetry={() => void query.refetch()} />
          ) : data && data.items.length === 0 ? (
            <EmptyState
              title={filtered ? "No documents match these filters." : "No documents yet. Drop files to start."}
            />
          ) : data ? (
            <DocumentsTable items={data.items} />
          ) : null}
        </div>
        {data && (
          <Pager
            page={params.page}
            pageSize={PAGE_SIZE}
            total={data.total}
            hrefFor={(page) => listHref({ ...params, page })}
          />
        )}
      </div>
    </div>
  );
}
