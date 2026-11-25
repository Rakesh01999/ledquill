"use client";

import { ShallowLink } from "@/components/shared/shallow-link";
import { cn } from "@/lib/utils";

export type Segment = { key: string; label: string; count?: number; href: string; active: boolean };

/**
 * A row of filter links that only change the URL. The selected one gets the primary-soft fill and
 * link colour. Its bold weight is reserved on every segment (the hidden copy in `::after`), so
 * switching filters never moves its neighbours. Below `sm` the same choices are a native select,
 * which stays one control wide on a phone instead of scrolling sideways.
 */
export function SegmentedFilter({ label, segments }: { label: string; segments: Segment[] }) {
  const current = segments.find((s) => s.active) ?? segments[0];
  const text = (s: Segment) => (s.count !== undefined ? `${s.label} ${s.count}` : s.label);
  return (
    <>
      <nav
        aria-label={label}
        className="hidden max-w-full overflow-x-auto rounded-md border border-line bg-surface text-xs sm:flex"
      >
        {segments.map((s, i) => (
          <ShallowLink
            data-focus-inset
            key={s.key}
            href={s.href}
            aria-current={s.active ? "true" : undefined}
            className={cn(
              "px-2.5 py-1.5 whitespace-nowrap outline-none hover:bg-surface-2",
              i > 0 && "border-l border-line",
              s.active ? "bg-primary-soft font-semibold text-link hover:bg-primary-soft" : "text-ink-2",
            )}
          >
            <span
              data-text={text(s)}
              className="flex flex-col items-center after:invisible after:block after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-text)]"
            >
              <span>
                {s.label}
                {s.count !== undefined && (
                <>
                  {" "}
                  <span className="tabular-nums">{s.count}</span>
                </>
              )}
              </span>
            </span>
          </ShallowLink>
        ))}
      </nav>
      <select
        aria-label={label}
        value={current?.key}
        onChange={(e) => {
          const next = segments.find((s) => s.key === e.target.value);
          if (next) window.history.pushState(null, "", next.href);
        }}
        className="h-8 min-w-0 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink sm:hidden"
      >
        {segments.map((s) => (
          <option key={s.key} value={s.key}>
            {text(s)}
          </option>
        ))}
      </select>
    </>
  );
}
