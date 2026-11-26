"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/*
 * Charts drawn with plain elements, no chart library: bars are flex children and links, so they
 * resize with the layout, are reachable from the keyboard, and every value is also written as text
 * (labels, legend, aria-labels). Colour is never the only carrier of meaning.
 */

export type Bar = {
  key: string;
  /** Short text under the axis, e.g. "Mar 26". */
  axis: string;
  /** Full description for the tooltip and screen readers, e.g. "March 2026". */
  title: string;
  value: number;
  href?: string;
};

/** A "nice" top for the scale so the tallest bar does not touch the edge. */
function niceMax(max: number): number {
  if (max <= 4) return Math.max(1, max);
  const mag = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= max) ?? 10;
  return step * mag;
}

/**
 * Column chart. One tab stop; Left / Right / Home / End move between bars (roving tabindex), Enter
 * opens the list behind the focused bar. Zero bars are not links: there is nothing to open.
 */
export function BarChart({
  bars,
  unit,
  label,
  className,
}: {
  bars: Bar[];
  /** Singular and plural of what is counted: ["invoice", "invoices"]. */
  unit: [string, string];
  label: string;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const showValues = bars.length <= 14;
  const labelEvery = Math.max(1, Math.ceil(bars.length / 6));

  function onKeyDown(event: KeyboardEvent) {
    const last = bars.length - 1;
    const next =
      event.key === "ArrowRight" ? Math.min(last, active + 1)
      : event.key === "ArrowLeft" ? Math.max(0, active - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        role="group"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="relative h-48 border-b border-line-strong"
      >
        {[0.5, 1].map((f) => (
          <div
            key={f}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line"
            style={{ bottom: `calc((100% - 16px) * ${f})` }}
          >
            <span className="absolute -top-4 left-0 text-[10px] text-ink-3 tabular-nums">{Math.round(max * f)}</span>
          </div>
        ))}
        <div className="relative flex h-full items-end gap-px sm:gap-0.5">
          {bars.map((bar, i) => {
            const height = `calc((100% - 16px) * ${bar.value / max})`;
            const text = `${bar.title}: ${bar.value} ${bar.value === 1 ? unit[0] : unit[1]}`;
            const body = (
              <>
                {showValues && bar.value > 0 && (
                  <span className="mb-0.5 text-[11px] leading-none text-ink-2 tabular-nums">{bar.value}</span>
                )}
                <span
                  className={cn(
                    "w-full rounded-t-sm",
                    bar.value > 0 ? "min-h-[3px] bg-primary group-hover:bg-link group-focus-visible:bg-link" : "min-h-px bg-line-strong",
                  )}
                  style={{ height: bar.value > 0 ? height : undefined }}
                />
              </>
            );
            const column = "group flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none";
            return (
              <div key={bar.key} className="relative flex h-full min-w-0 flex-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    {bar.href && bar.value > 0 ? (
                      <Link
                        ref={(el) => {
                          refs.current[i] = el;
                        }}
                        href={bar.href}
                        tabIndex={i === active ? 0 : -1}
                        onFocus={() => setActive(i)}
                        aria-label={`${text}. Open these invoices`}
                        className={cn(column, "rounded-t-sm focus-visible:ring-2 focus-visible:ring-primary")}
                      >
                        {body}
                      </Link>
                    ) : (
                      <span
                        ref={(el) => {
                          refs.current[i] = el;
                        }}
                        tabIndex={i === active ? 0 : -1}
                        onFocus={() => setActive(i)}
                        role="img"
                        aria-label={text}
                        className={cn(column, "focus-visible:ring-2 focus-visible:ring-primary")}
                      >
                        {body}
                      </span>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <span className="font-medium">{bar.title}</span>
                    <br />
                    {bar.value} {bar.value === 1 ? unit[0] : unit[1]}
                    {bar.href && bar.value > 0 ? " · click to open" : ""}
                  </TooltipContent>
                </Tooltip>
                {i % labelEvery === 0 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute top-full mt-1 text-[10px] whitespace-nowrap text-ink-3",
                      i === 0 ? "left-0" : "left-1/2 -translate-x-1/2",
                    )}
                  >
                    {bar.axis}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div aria-hidden="true" className="h-4" />
    </div>
  );
}

export type Row = {
  key: string;
  label: string;
  /** The number the bar is drawn from. */
  value: number;
  /** The same quantity as text, shown at the right. */
  text: string;
  /** Second line of text, e.g. money. */
  note?: string;
  href?: string;
  /** Bar colour class; defaults to the primary colour. */
  barClass?: string;
};

/** Horizontal bars with the value written next to each: a ranked list that is also a chart. */
export function RowBars({ rows, label, className }: { rows: Row[]; label: string; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className={cn("flex flex-col", className)}>
      {rows.map((row) => {
        const name = (
          <span className="min-w-0 flex-1 truncate" title={row.label}>
            {row.label}
          </span>
        );
        const inner = (
          <>
            <span className="flex items-baseline gap-3 text-table">
              {name}
              <span className="flex-none text-right tabular-nums">{row.text}</span>
            </span>
            <span aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <span
                className={cn("block h-full rounded-full", row.barClass ?? "bg-primary")}
                style={{ width: `${Math.max(row.value > 0 ? 2 : 0, (row.value / max) * 100)}%` }}
              />
            </span>
            {row.note && <span className="text-xs text-ink-3 tabular-nums">{row.note}</span>}
          </>
        );
        const base = "flex flex-col gap-1 px-4 py-2.5";
        return (
          <li key={row.key} className="border-b border-line last:border-b-0">
            {row.href ? (
              <Link
                href={row.href}
                className={cn(base, "outline-none hover:bg-surface-2/60 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset")}
              >
                {inner}
              </Link>
            ) : (
              <div className={base}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type Segment = { key: string; label: string; value: number; href?: string; className: string };

/**
 * One stacked bar split into parts, with a legend that gives each part's name, count and share.
 * A part's width shows its share; its text does not depend on colour.
 */
export function StackedBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div role="group" aria-label={label} className="flex h-6 w-full gap-0.5 overflow-hidden rounded-md">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const share = Math.round((s.value / total) * 100);
            const cls = cn("min-w-1 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1", s.className);
                        const aria = `${s.label}: ${s.value} (${share}%)`;
            return (
              <Tooltip key={s.key}>
                <TooltipTrigger asChild>
                  {s.href ? (
                    <Link href={s.href} aria-label={`${aria}. Open these invoices`} className={cls} style={{ flexGrow: s.value }}>
                      
                    </Link>
                  ) : (
                    <span role="img" aria-label={aria} className={cls} style={{ flexGrow: s.value }}>
                      
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent side="top">
                  {s.label}: {s.value} ({share}%)
                </TooltipContent>
              </Tooltip>
            );
          })}
      </div>
      <ul className="flex flex-col gap-1.5 text-table">
        {segments.map((s) => {
          const body = (
            <>
              <span aria-hidden="true" className={cn("size-2.5 flex-none rounded-sm", s.className)} />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="tabular-nums">{s.value}</span>
              <span className="w-10 text-right text-xs text-ink-3 tabular-nums">
                {total === 0 ? "0%" : `${Math.round((s.value / total) * 100)}%`}
              </span>
            </>
          );
          return (
            <li key={s.key}>
              {s.href ? (
                <Link href={s.href} className="-mx-1 flex items-center gap-2 rounded-sm px-1 py-0.5 outline-none hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-primary">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-2 py-0.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A tiny line of the series, decoration only: the numbers are written beside it. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(22 - (v / max) * 20).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" className={cn("h-6 w-full overflow-visible", className)}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A chart panel: title, optional right-hand note, body. */
export function Panel({
  title,
  note,
  children,
  className,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface", className)}>
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <span className="text-xs text-ink-3">{note}</span>}
      </div>
      {children}
    </section>
  );
}
