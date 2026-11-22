"use client";

import { ShallowLink } from "@/components/shared/shallow-link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { DocumentStatus } from "@/lib/api/types";
import { FILE_TYPES, STATUSES, listHref } from "@/lib/documents";
import type { DocumentListParams } from "@/lib/query/options";
import { statsOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";

const LABELS: Record<DocumentStatus, string> = {
  processing: "Processing",
  queued: "Queued",
  completed: "Completed",
  failed: "Failed",
};

/** Status segments with live counts from /stats, and a file type filter. Both live in the URL. */
export function StatusFilter({ params }: { params: DocumentListParams }) {
  const { data: stats } = useQuery(statsOptions(api));
  const counts = stats?.documents.by_status;
  const total = stats?.documents.total;

  const segments: { key: string; label: string; count?: number; status?: DocumentStatus }[] = [
    { key: "all", label: "All", count: total },
    ...STATUSES.map((s) => ({ key: s, label: LABELS[s], count: counts?.[s], status: s })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-sm font-semibold">Uploads</h2>
      <nav aria-label="Filter by status" className="flex max-w-full overflow-x-auto rounded-md border border-line bg-surface text-xs">
        {segments.map((s, i) => {
          const active = (params.status ?? "all") === s.key;
          return (
            <ShallowLink
              data-focus-inset
              key={s.key}
              href={listHref({ ...params, status: s.status, page: 1 })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "px-2.5 py-1.5 whitespace-nowrap text-ink-2 outline-none hover:bg-surface-2",
                i > 0 && "border-l border-line",
                active && "bg-surface-2 font-semibold text-ink",
              )}
            >
              {s.label}
              {s.count !== undefined && <span className="ml-1 tabular-nums">{s.count}</span>}
            </ShallowLink>
          );
        })}
      </nav>
      <nav aria-label="Filter by file type" className="flex max-w-full overflow-x-auto rounded-md border border-line bg-surface text-xs">
        {[{ value: undefined, label: "Any type" }, ...FILE_TYPES].map((t, i) => {
          const active = params.file_type === t.value;
          return (
            <ShallowLink
              data-focus-inset
              key={t.label}
              href={listHref({ ...params, file_type: t.value, page: 1 })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "px-2.5 py-1.5 whitespace-nowrap text-ink-2 outline-none hover:bg-surface-2",
                i > 0 && "border-l border-line",
                active && "bg-surface-2 font-semibold text-ink",
              )}
            >
              {t.label}
            </ShallowLink>
          );
        })}
      </nav>
    </div>
  );
}
