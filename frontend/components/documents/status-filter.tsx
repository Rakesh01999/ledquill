"use client";

import { FilterChips, type Chip } from "@/components/shared/filter-chips";
import { SegmentedFilter, type Segment } from "@/components/shared/segmented-filter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { DocumentStatus } from "@/lib/api/types";
import { FILE_TYPES, STATUSES, listHref } from "@/lib/documents";
import type { DocumentListParams } from "@/lib/query/options";
import { statsOptions } from "@/lib/query/options";

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

  const statusSource: { key: string; label: string; count?: number; status?: DocumentStatus }[] = [
    { key: "all", label: "All", count: total },
    ...STATUSES.map((s) => ({ key: s, label: LABELS[s], count: counts?.[s], status: s })),
  ];
  const statuses: Segment[] = statusSource.map((s) => ({
    key: s.key,
    label: s.label,
    count: s.count,
    href: listHref({ ...params, status: s.status, page: 1 }),
    active: (params.status ?? "all") === s.key,
  }));

  const typeSource = [{ value: undefined, label: "Any type" }, ...FILE_TYPES];
  const types: Segment[] = typeSource.map((t) => ({
    key: t.value ?? "any",
    label: t.label,
    href: listHref({ ...params, file_type: t.value, page: 1 }),
    active: params.file_type === t.value,
  }));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-sm font-semibold">Documents</h2>
      <SegmentedFilter label="Filter by status" segments={statuses} />
      <SegmentedFilter label="Filter by file type" segments={types} />
    </div>
  );
}

/** The active status and file type as removable chips. */
export function DocumentChips({ params }: { params: DocumentListParams }) {
  const chips: Chip[] = [];
  if (params.status) {
    chips.push({ key: "status", label: `Status: ${LABELS[params.status]}`, href: listHref({ ...params, status: undefined, page: 1 }) });
  }
  if (params.file_type) {
    const label = FILE_TYPES.find((t) => t.value === params.file_type)?.label ?? params.file_type;
    chips.push({ key: "file_type", label: `Type: ${label}`, href: listHref({ ...params, file_type: undefined, page: 1 }) });
  }
  return <FilterChips chips={chips} clearHref={listHref({ page: 1, size: params.size })} />;
}
