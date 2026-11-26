"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Combobox } from "@/components/shared/combobox";
import { DebouncedInput } from "@/components/shared/debounced-input";
import { FilterChips, type Chip } from "@/components/shared/filter-chips";
import { SearchInput } from "@/components/shared/search-input";
import { SegmentedFilter } from "@/components/shared/segmented-filter";
import { api } from "@/lib/api/client";
import { invoicesHref, type InvoiceListParams } from "@/lib/invoices";
import { facetsOptions, statsOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";

const STATUS_SEGMENTS: { key: InvoiceListParams["status"] | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "ready", label: "Ready" },
  { key: "approved", label: "Approved" },
];

const field =
  "h-8 rounded-md border border-line-strong bg-surface px-2.5 text-table text-ink outline-none placeholder:text-ink-3";

/** Change the URL only: replaceState while typing, so Back is not flooded with every keystroke. */
function replaceUrl(params: InvoiceListParams) {
  window.history.replaceState(null, "", invoicesHref(params));
}

export function InvoiceFilters({ params, searching = false }: { params: InvoiceListParams; searching?: boolean }) {
  const [supplierQuery, setSupplierQuery] = useState("");
  const facets = useQuery(facetsOptions(api, supplierQuery));
  const onSupplierQuery = useCallback((q: string) => setSupplierQuery(q), []);
  const { data: stats } = useQuery(statsOptions(api));
  const counts = stats?.invoices.by_status;
  const set = (patch: Partial<InvoiceListParams>) => replaceUrl({ ...params, ...patch, page: 1 });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          id="invoice-q"
          label="Search invoices"
          value={params.q ?? ""}
          onCommit={(q) => set({ q: q.trim() || undefined })}
          loading={searching}
          placeholder="Search by number, supplier, amount or meaning"
          className="w-full max-w-[380px] min-w-56 flex-1"
        />
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
        <Combobox
          label="Supplier"
          className="w-52"
          selected={params.supplier ?? []}
          onChange={(next) => set({ supplier: next.length > 0 ? next : undefined })}
          options={(facets.data?.suppliers ?? []).map((f) => ({ value: f.value, hint: f.count }))}
          onQueryChange={onSupplierQuery}
          loading={facets.isFetching}
          error={facets.isError}
          searchPlaceholder="Search suppliers"
          emptyText="No supplier matches"
        />
        <Combobox
          label="Currency"
          className="w-36"
          selected={params.currency ?? []}
          onChange={(next) => set({ currency: next.length > 0 ? next : undefined })}
          options={(facets.data?.currencies ?? []).map((f) => ({ value: f.value, hint: f.count }))}
          loading={facets.isFetching}
          error={facets.isError}
          searchPlaceholder="Search currencies"
          emptyText="No currency matches"
        />
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
      <InvoiceChips params={params} />
    </>
  );
}

const STATUS_LABEL: Record<string, string> = { needs_review: "Needs review", ready: "Ready", approved: "Approved" };

/** Every active filter, including the search text, as a removable chip. */
function InvoiceChips({ params }: { params: InvoiceListParams }) {
  const without = (patch: Partial<InvoiceListParams>) => invoicesHref({ ...params, ...patch, page: 1 });
  const chips: Chip[] = [];
  if (params.q) chips.push({ key: "q", label: `Search: “${params.q}”`, href: without({ q: undefined }) });
  if (params.status) {
    chips.push({ key: "status", label: `Status: ${STATUS_LABEL[params.status]}`, href: without({ status: undefined }) });
  }
  // One chip per chosen supplier and currency, each removing only itself.
  for (const name of params.supplier ?? []) {
    const rest = (params.supplier ?? []).filter((v) => v !== name);
    chips.push({ key: `supplier:${name}`, label: `Supplier: ${name}`, href: without({ supplier: rest.length ? rest : undefined }) });
  }
  for (const code of params.currency ?? []) {
    const rest = (params.currency ?? []).filter((v) => v !== code);
    chips.push({ key: `currency:${code}`, label: `Currency: ${code}`, href: without({ currency: rest.length ? rest : undefined }) });
  }
  if (params.date_from) chips.push({ key: "date_from", label: `Date from ${params.date_from}`, href: without({ date_from: undefined }) });
  if (params.date_to) chips.push({ key: "date_to", label: `Date to ${params.date_to}`, href: without({ date_to: undefined }) });
  if (params.min_total) chips.push({ key: "min_total", label: `Total from ${params.min_total}`, href: without({ min_total: undefined }) });
  if (params.max_total) chips.push({ key: "max_total", label: `Total to ${params.max_total}`, href: without({ max_total: undefined }) });
  return <FilterChips chips={chips} clearHref={invoicesHref({ page: 1, size: params.size })} />;
}
