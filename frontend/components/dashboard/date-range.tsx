"use client";

import { useSearchParams } from "next/navigation";
import { ShallowLink } from "@/components/shared/shallow-link";
import { dashboardHref, PRESETS, type DashRange } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

const field =
  "h-8 w-36 rounded-md border border-line-control bg-surface px-2.5 text-table text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * The dashboard's date range: presets as links and a custom From / To. Everything is in the URL, so
 * the range survives a reload, can be shared, and Back restores it. Presets push a history entry;
 * dates replace it, so picking a date does not flood Back.
 */
export function DateRangeSelect({ range }: { range: DashRange }) {
  // The inputs show what is in the URL, even a reversed pair (which the data then ignores).
  const sp = useSearchParams();
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const setCustom = (patch: { date_from?: string; date_to?: string }) => {
    const next = { date_from: from || undefined, date_to: to || undefined, ...patch };
    const href = next.date_from || next.date_to ? dashboardHref({ preset: "custom", ...next }) : dashboardHref({ preset: "all" });
    window.history.replaceState(null, "", href);
  };
  const reversed = Boolean(from && to && from > to);

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <nav aria-label="Date range" className="flex max-w-full overflow-x-auto rounded-md border border-line bg-surface text-xs">
        {PRESETS.map((p, i) => {
          const active = range.preset === p.key;
          return (
            <ShallowLink
              key={p.key}
              data-focus-inset
              href={dashboardHref({ preset: p.key })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "px-2.5 py-1.5 whitespace-nowrap outline-none hover:bg-surface-2",
                i > 0 && "border-l border-line",
                active ? "bg-primary-soft font-semibold text-link hover:bg-primary-soft" : "text-ink-2",
              )}
            >
              {p.label}
            </ShallowLink>
          );
        })}
      </nav>
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        From
        <input
          type="date"
          value={from}
          onChange={(e) => setCustom({ date_from: e.target.value || undefined })}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        To
        <input
          type="date"
          value={to}
          onChange={(e) => setCustom({ date_to: e.target.value || undefined })}
          className={field}
        />
      </label>
      {reversed && (
        <p role="alert" className="pb-1.5 text-xs text-danger">
          The start date is after the end date.
        </p>
      )}
    </div>
  );
}
