"use client";

import { Search } from "lucide-react";
import { DebouncedInput } from "@/components/shared/debounced-input";
import { SegmentedFilter } from "@/components/shared/segmented-filter";
import { invoicesHref, type InvoiceListParams } from "@/lib/invoices";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { statsOptions } from "@/lib/query/options";

const STATUS_SEGMENTS: { key: InvoiceListParams["status"] | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "ready", label: "Ready" },
  { key: "approved", label: "Approved" },
];

const field =
  "h-8 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3";

/** Change the URL only: replaceState while typing, so Back is not flooded with every keystroke. */
function replaceUrl(params: InvoiceListParams) {
  window.history.replaceState(null, "", invoicesHref(params));
}

export function InvoiceFilters({ params }: { params: InvoiceListParams }) {
  const { data: stats } = useQuery(statsOptions(api));
  const counts = stats?.invoices.by_status;
  const set = (patch: Partial<InvoiceListParams>) => replaceUrl({ ...params, ...patch, page: 1 });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-[380px] min-w-56 flex-1">
          <label htmlFor="invoice-q" className="sr-only">
            Search invoices
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <DebouncedInput
            id="invoice-q"
            type="search"
            value={params.q ?? ""}
            onCommit={(q) => set({ q: q.trim() || undefined })}
            placeholder="Search by number, supplier, amount or meaning"
            className={cn(field, "w-full pl-8")}
          />
        </div>
        <SegmentedFilter
          label="Filter by status"
          segments={STATUS_SEGMENTS.map((s) => {
            const status = s.key === "all" ? undefined : s.key;
            return {
              key: s.key ?? "all",
              label: s.label,
              count: s.key === "all" ? stats?.invoices.total : counts?.[s.key as string],
              href: invoicesHref({ ...params, status, page: 1 }),
              active: params.status === status,
            };
          })}
        />
      </div>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Supplier
          <DebouncedInput
            value={params.supplier ?? ""}
            onCommit={(v) => set({ supplier: v.trim() || undefined })}
            className={cn(field, "w-44")}
            placeholder="Any"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Currency
          <DebouncedInput
            value={params.currency ?? ""}
            onCommit={(v) => set({ currency: v.trim().toUpperCase() || undefined })}
            className={cn(field, "w-20 uppercase")}
            maxLength={3}
            placeholder="Any"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Date from
          <input
            type="date"
            value={params.date_from ?? ""}
            onChange={(e) => set({ date_from: e.target.value || undefined })}
            className={cn(field, "w-36")}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Date to
          <input
            type="date"
            value={params.date_to ?? ""}
            onChange={(e) => set({ date_to: e.target.value || undefined })}
            className={cn(field, "w-36")}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Total from
          <DebouncedInput
            value={params.min_total ?? ""}
            onCommit={(v) => set({ min_total: v.trim() || undefined })}
            inputMode="decimal"
            className={cn(field, "w-28 text-right tabular-nums")}
            placeholder="0.00"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Total to
          <DebouncedInput
            value={params.max_total ?? ""}
            onCommit={(v) => set({ max_total: v.trim() || undefined })}
            inputMode="decimal"
            className={cn(field, "w-28 text-right tabular-nums")}
            placeholder="0.00"
          />
        </label>
      </div>
    </div>
  );
}
