import { DEFAULT_PAGE_SIZE } from "@/lib/paging";
import { invoicesHref, type InvoiceListParams } from "@/lib/invoices";

/**
 * The dashboard's date range lives in the URL: `?range=30d|90d|12m` for a preset, `?from=&to=` for a
 * custom one, nothing for all time. It applies to invoice_date, exactly like the Invoices list
 * filters `date_from` / `date_to`, so every number can be reproduced by a drill-down.
 */
export type RangePreset = "all" | "30d" | "90d" | "12m";
export const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "12m", label: "Last 12 months" },
];

export type DashRange = { preset: RangePreset | "custom"; date_from?: string; date_to?: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** A local calendar date as YYYY-MM-DD. */
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Add days to an ISO date without any time zone involved. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function parseRange(sp: URLSearchParams, today: Date = new Date()): DashRange {
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  const validFrom = from && ISO.test(from) ? from : undefined;
  const validTo = to && ISO.test(to) ? to : undefined;
  if (validFrom || validTo) {
    // A reversed range means nothing; fall back to all time rather than show an empty dashboard.
    if (validFrom && validTo && validFrom > validTo) return { preset: "all" };
    return { preset: "custom", date_from: validFrom, date_to: validTo };
  }
  const end = isoDate(today);
  switch (sp.get("range")) {
    case "30d":
      return { preset: "30d", date_from: addDays(end, -29), date_to: end };
    case "90d":
      return { preset: "90d", date_from: addDays(end, -89), date_to: end };
    case "12m": {
      const start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1);
      return { preset: "12m", date_from: isoDate(start), date_to: end };
    }
    default:
      return { preset: "all" };
  }
}

/** The dashboard URL for a range (what the selector links to). */
export function dashboardHref(range: { preset: RangePreset | "custom"; date_from?: string; date_to?: string }): string {
  const q = new URLSearchParams();
  if (range.preset === "custom") {
    if (range.date_from) q.set("from", range.date_from);
    if (range.date_to) q.set("to", range.date_to);
  } else if (range.preset !== "all") {
    q.set("range", range.preset);
  }
  const s = q.toString();
  return s ? `/dashboard?${s}` : "/dashboard";
}

/** The Invoices list for a slice of the dashboard, inside the chosen range. */
export function listHref(extra: Partial<InvoiceListParams>, range: DashRange): string {
  return invoicesHref({
    page: 1,
    size: DEFAULT_PAGE_SIZE,
    ...extra,
    date_from: extra.date_from ?? range.date_from,
    date_to: extra.date_to ?? range.date_to,
  });
}

export type Bucket = "day" | "week" | "month";

/** Last day of the bucket that starts on `period`. */
export function bucketEnd(period: string, bucket: Bucket): string {
  if (bucket === "day") return period;
  if (bucket === "week") return addDays(period, 6);
  const [y, m] = period.split("-").map(Number) as [number, number];
  return addDays(`${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01`, -1);
}

/** The list URL for one bar: the bucket's days, clamped to the range so the list matches the bar. */
export function bucketHref(period: string, bucket: Bucket, range: DashRange): string {
  const end = bucketEnd(period, bucket);
  const from = range.date_from && range.date_from > period ? range.date_from : period;
  const to = range.date_to && range.date_to < end ? range.date_to : end;
  return listHref({ date_from: from, date_to: to }, range);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (iso: string): [number, string, number] => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return [y, MONTHS[m - 1] ?? "", d];
};

/** "5 Jan 2026" */
export function dayLabel(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${d} ${m} ${y}`;
}

/** Short axis label and full description of a bucket. */
export function periodLabel(period: string, bucket: Bucket): { short: string; full: string } {
  const [y, m, d] = parts(period);
  if (bucket === "month") return { short: `${m} ${String(y).slice(2)}`, full: `${m} ${y}` };
  if (bucket === "week") return { short: `${d} ${m}`, full: `Week of ${d} ${m} ${y}` };
  return { short: `${d} ${m}`, full: `${d} ${m} ${y}` };
}

/** Words for the range, used in headings and empty states. */
export function rangeText(range: DashRange): string {
  if (range.preset === "all") return "all time";
  const preset = PRESETS.find((p) => p.key === range.preset);
  if (preset) return preset.label.toLowerCase();
  if (range.date_from && range.date_to) return `${dayLabel(range.date_from)} to ${dayLabel(range.date_to)}`;
  if (range.date_from) return `from ${dayLabel(range.date_from)}`;
  return range.date_to ? `up to ${dayLabel(range.date_to)}` : "all time";
}

export const pct = (part: number, whole: number): string =>
  whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
