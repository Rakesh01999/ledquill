"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { BadgeCheck, CircleCheck, FileText, Layers, TriangleAlert, type LucideIcon } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { bucketHref, listHref, parseRange, pct, periodLabel, rangeText, dashboardHref } from "@/lib/dashboard";
import { formatDuration, formatWhen, stageLabel } from "@/lib/documents";
import { formatDecimal } from "@/lib/format";
import { topIssue } from "@/lib/invoices";
import { attentionOptions, documentsOptions, statsOptions, trendsOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";
import { BarChart, Panel, RowBars, Sparkline, StackedBar, type Bar, type Row, type Segment } from "./charts";
import { DateRangeSelect } from "./date-range";

const STAGE_ORDER = ["detect", "extract", "split", "fields", "validate", "index"];
const STATUS_BAR: Record<string, string> = { needs_review: "bg-warn-dot", ready: "bg-primary", approved: "bg-ok" };
const STATUS_NAME: Record<string, string> = { needs_review: "Needs review", ready: "Ready", approved: "Approved" };

const percent = (rate: number | null): string | null =>
  rate === null ? null : `${(rate * 100).toLocaleString("en", { maximumFractionDigits: 1 })}%`;

/** Loading, error or the content, for one panel: a failing panel never takes the page down. */
function Async<T>({
  query,
  skeleton,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <div aria-busy="true" role="status" aria-label="Loading">
        <Skeleton className={cn("w-full rounded-none bg-skeleton", skeleton)} />
      </div>
    );
  }
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return null;
  return <>{children(query.data)}</>;
}

function Kpi({
  label,
  value,
  note,
  href,
  icon: Icon,
  tone = "text-ink-3",
  children,
}: {
  label: string;
  value: string;
  note: string;
  href: string;
  icon: LucideIcon;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface px-4 py-3 outline-none hover:border-line-strong hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="flex items-center justify-between gap-2 text-xs text-ink-2">
        {label}
        <Icon className={cn("size-4 flex-none", tone)} aria-hidden="true" />
      </span>
      <span className="text-2xl leading-8 font-semibold tabular-nums">{value}</span>
      <span className="line-clamp-2 text-xs text-ink-3">{note}</span>
      {children}
    </Link>
  );
}

function KpiSkeleton() {
  return <Skeleton className="h-[104px] w-full rounded-lg bg-skeleton" />;
}

function NoInvoices({ clearHref }: { clearHref: string | null }) {
  return (
    <EmptyState
      title="No invoices in this date range."
      action={
        clearHref ? (
          <Link href={clearHref} className="text-[13px] font-medium text-link hover:underline">
            Show all time
          </Link>
        ) : undefined
      }
    />
  );
}

/** Pipeline health and the invoice picture, from /stats and /stats/trends. Every number is real. */
export function DashboardView() {
  const sp = useSearchParams();
  const range = useMemo(() => parseRange(sp), [sp]);
  const stats = useQuery(statsOptions(api));
  const trends = useQuery(trendsOptions(api, range));
  const attention = useQuery(attentionOptions(api));
  const recent = useQuery(documentsOptions(api, { page: 1, size: 5 }));
  const clearHref = range.preset === "all" ? null : dashboardHref({ preset: "all" });

  if (stats.isPending) return <DashboardSkeleton />;
  if (stats.error && !stats.data) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      </div>
    );
  }
  const s = stats.data;
  if (!s) return null;
  if (s.documents.total === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState
          title="No documents yet. Upload files to see pipeline figures."
          action={
            <Link href="/documents" className="text-[13px] font-medium text-link hover:underline">
              Go to documents
            </Link>
          }
        />
      </div>
    );
  }

  const d = s.documents.by_status;
  const t = trends.data;
  const inRange = t?.total ?? 0;
  const stages = Object.entries(s.avg_stage_ms).sort(
    ([a], [b]) => (STAGE_ORDER.indexOf(a) + 1 || 99) - (STAGE_ORDER.indexOf(b) + 1 || 99),
  );
  const noFinished = s.success_rate === null;
  const scope = rangeText(range);

  const bars: Bar[] = (t?.series ?? []).map((p) => {
    const label = periodLabel(p.period, t!.bucket);
    return { key: p.period, axis: label.short, title: label.full, value: p.count, href: bucketHref(p.period, t!.bucket, range) };
  });
  const busiest = bars.reduce<Bar | undefined>((best, b) => (!best || b.value > best.value ? b : best), undefined);
  const noun = t?.bucket === "month" ? "month" : t?.bucket === "week" ? "week" : "day";

  const segments: Segment[] = Object.keys(STATUS_NAME).map((key) => ({
    key,
    label: STATUS_NAME[key] ?? key,
    value: t?.by_status[key] ?? 0,
    href: listHref({ status: key as "ready" }, range),
    className: STATUS_BAR[key] ?? "bg-primary",
  }));

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <p className="text-[13px] text-ink-2">
          Invoice figures for <span className="font-medium text-ink">{scope}</span>, by invoice date. Documents and
          pipeline figures cover all uploads.
        </p>
        <DateRangeSelect range={range} />
      </div>

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {trends.isPending ? (
          Array.from({ length: 4 }, (_, i) => <KpiSkeleton key={i} />)
        ) : trends.error && !t ? (
          <div className="col-span-full rounded-lg border border-line bg-surface">
            <ErrorState error={trends.error} onRetry={() => void trends.refetch()} />
          </div>
        ) : (
          <>
            <Kpi
              label="Invoices"
              value={String(inRange)}
              note={t && t.undated > 0 ? `${t.undated} without a date, not in a range` : `Dated ${scope}`}
              href={listHref({}, range)}
              icon={Layers}
            >
              <Sparkline values={(t?.series ?? []).map((p) => p.count)} className="text-primary" />
            </Kpi>
            <Kpi
              label="Needs review"
              value={String(t?.by_status.needs_review ?? 0)}
              note={`${pct(t?.by_status.needs_review ?? 0, inRange)} of invoices`}
              href={listHref({ status: "needs_review" }, range)}
              icon={TriangleAlert}
              tone="text-warn-dot"
            />
            <Kpi
              label="Ready"
              value={String(t?.by_status.ready ?? 0)}
              note={`${pct(t?.by_status.ready ?? 0, inRange)} of invoices`}
              href={listHref({ status: "ready" }, range)}
              icon={CircleCheck}
              tone="text-primary"
            />
            <Kpi
              label="Approved"
              value={String(t?.by_status.approved ?? 0)}
              note={`${pct(t?.by_status.approved ?? 0, inRange)} of invoices`}
              href={listHref({ status: "approved" }, range)}
              icon={BadgeCheck}
              tone="text-ok"
            />
          </>
        )}
        <Kpi
          label="Documents"
          value={String(s.documents.total)}
          note={`${d.failed ?? 0} failed · ${(d.queued ?? 0) + (d.processing ?? 0)} in progress`}
          href={(d.failed ?? 0) > 0 ? "/documents?status=failed" : "/documents"}
          icon={FileText}
          tone={(d.failed ?? 0) > 0 ? "text-danger" : "text-ink-3"}
        />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel
          title="Invoices over time"
          note={t && t.total > 0 ? `Per ${noun}` : undefined}
          className="lg:col-span-2"
        >
          <Async query={trends} skeleton="h-[280px]">
            {(data) =>
              data.total === 0 || bars.length === 0 ? (
                <NoInvoices clearHref={clearHref} />
              ) : (
                <div className="px-4 pt-6 pb-2">
                  <BarChart bars={bars} unit={["invoice", "invoices"]} label={`Invoices per ${noun}, ${scope}`} />
                  <p className="mt-1 text-xs text-ink-2">
                    {data.total} {data.total === 1 ? "invoice" : "invoices"} in {bars.length}{" "}
                    {bars.length === 1 ? noun : `${noun}s`}
                    {busiest && busiest.value > 0 && (
                      <>
                        . Busiest: {busiest.title} ({busiest.value}).
                      </>
                    )}{" "}
                    Select a bar to open its invoices.
                  </p>
                </div>
              )
            }
          </Async>
        </Panel>

        <Panel title="Invoices by status" note={scope}>
          <Async query={trends} skeleton="h-[200px]">
            {(data) =>
              data.total === 0 ? <NoInvoices clearHref={clearHref} /> : <StackedBar segments={segments} label="Invoices by status" />
            }
          </Async>
        </Panel>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel title="Top suppliers" note="By invoice count">
          <Async query={trends} skeleton="h-[260px]">
            {(data) =>
              data.top_suppliers.length === 0 ? (
                <NoInvoices clearHref={clearHref} />
              ) : (
                <RowBars
                  label="Top suppliers"
                  rows={data.top_suppliers.map<Row>((sup) => ({
                    key: sup.supplier,
                    label: sup.supplier,
                    value: sup.count,
                    text: `${sup.count} ${sup.count === 1 ? "invoice" : "invoices"}`,
                    note: sup.amounts.map((a) => `${a.currency} ${formatDecimal(a.total)}`).join(" · ") || undefined,
                    href: listHref({ supplier: [sup.supplier] }, range),
                  }))}
                />
              )
            }
          </Async>
        </Panel>

        <Panel title="Currency split" note="Totals never mixed across currencies">
          <Async query={trends} skeleton="h-[260px]">
            {(data) =>
              data.currencies.length === 0 ? (
                <NoInvoices clearHref={clearHref} />
              ) : (
                <>
                  <RowBars
                    label="Invoices by currency"
                    rows={data.currencies.map<Row>((c) => ({
                      key: c.currency,
                      label: c.currency,
                      value: c.count,
                      text: `${c.count} ${c.count === 1 ? "invoice" : "invoices"}`,
                      note: `Total ${formatDecimal(c.total)}`,
                      href: listHref({ currency: [c.currency] }, range),
                    }))}
                  />
                  {data.unknown_currency > 0 && (
                    <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                      {data.unknown_currency} {data.unknown_currency === 1 ? "invoice has" : "invoices have"} no currency.
                    </p>
                  )}
                </>
              )
            }
          </Async>
        </Panel>

        <Panel title="Needs attention" note="Worst first">
          <Async query={attention} skeleton="h-[260px]">
            {(data) =>
              data.items.length === 0 ? (
                <EmptyState title="Nothing is waiting for review." />
              ) : (
                <>
                  <ul>
                    {data.items.map((inv) => {
                      const issue = topIssue(inv);
                      return (
                        <li key={inv.id} className="border-b border-line last:border-b-0">
                          <Link
                            href={`/invoices/${inv.id}?queue=1`}
                            className="flex flex-col gap-0.5 px-4 py-2.5 outline-none hover:bg-surface-2/60 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                          >
                            <span className="flex items-baseline justify-between gap-3 text-[13px]">
                              <span className="min-w-0 truncate font-mono font-medium text-link">
                                {inv.invoice_number ?? "No invoice number"}
                              </span>
                              <span className="flex-none tabular-nums">
                                {inv.total ? `${inv.currency ?? ""} ${formatDecimal(inv.total)}`.trim() : "—"}
                              </span>
                            </span>
                            <span className="truncate text-xs text-ink-2">{inv.supplier_name ?? "Supplier not found"}</span>
                            {issue && (
                              <span className={cn("flex items-start gap-1 text-xs", issue.severity === "error" ? "text-danger" : "text-warn")}>
                                <TriangleAlert className="mt-px size-3 flex-none" aria-hidden="true" />
                                <span className="line-clamp-2">
                                  {issue.severity === "error" ? "Error" : "Warning"}: {issue.message}
                                </span>
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  <Link
                    href="/review"
                    className="border-t border-line px-4 py-2 text-[13px] font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                  >
                    Open the review queue ({s.needs_review})
                  </Link>
                </>
              )
            }
          </Async>
        </Panel>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel title="Recent documents" note="Newest first">
          <Async query={recent} skeleton="h-[260px]">
            {(data) =>
              data.items.length === 0 ? (
                <EmptyState title="No documents yet." />
              ) : (
                <>
                  <ul>
                    {data.items.map((doc) => (
                      <li key={doc.id} className="border-b border-line last:border-b-0">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="flex flex-col gap-1 px-4 py-2.5 outline-none hover:bg-surface-2/60 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                        >
                          <span className="truncate text-[13px] font-medium text-link" title={doc.filename}>
                            {doc.filename}
                          </span>
                          <span className="flex items-center gap-2 text-xs text-ink-2">
                            <StatusChip status={doc.status} />
                            <span suppressHydrationWarning>{formatWhen(doc.created_at)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/documents"
                    className="border-t border-line px-4 py-2 text-[13px] font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                  >
                    All documents ({s.documents.total})
                  </Link>
                </>
              )
            }
          </Async>
        </Panel>

        <Panel title="Pipeline health" note="All uploads">
          <dl className="grid grid-cols-3 divide-x divide-line border-b border-line">
            {[
              ["Success", percent(s.success_rate), noFinished ? "None finished" : `${d.completed ?? 0} completed`],
              ["Failure", percent(s.failure_rate), noFinished ? "None finished" : `${d.failed ?? 0} failed`],
              [
                "Avg time",
                s.avg_processing_seconds === null
                  ? null
                  : `${s.avg_processing_seconds.toLocaleString("en", { maximumFractionDigits: 1 })} s`,
                "Per document",
              ],
            ].map(([label, value, note]) => (
              <div key={label} className="flex min-w-0 flex-col gap-0.5 px-3 py-3">
                <dt className="text-xs text-ink-2">{label}</dt>
                <dd className="text-lg leading-6 font-semibold tabular-nums">{value ?? <span className="text-ink-3">—</span>}</dd>
                <dd className="truncate text-xs text-ink-3">{note}</dd>
              </div>
            ))}
          </dl>
          <RowBars
            label="Documents by status"
            rows={(
              [
                ["queued", "Queued", "bg-idle"],
                ["processing", "Processing", "bg-idle"],
                ["completed", "Completed", "bg-ok"],
                ["failed", "Failed", "bg-danger"],
              ] as const
            ).map<Row>(([key, name, bar]) => ({
              key,
              label: name,
              value: d[key] ?? 0,
              text: String(d[key] ?? 0),
              barClass: bar,
              href: `/documents?status=${key}`,
            }))}
          />
        </Panel>

        <Panel title="Average time per step">
          {stages.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-2">No steps have finished yet.</p>
          ) : (
            <RowBars
              label="Average time per pipeline step"
              rows={stages.map<Row>(([stage, ms]) => ({
                key: stage,
                label: stageLabel(stage),
                value: ms,
                text: formatDuration(Math.round(ms)),
              }))}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Same blocks as the page: range row, key figures, the charts and the lists. */
export function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4" aria-busy="true">
      <Skeleton className="h-8 w-full max-w-xl bg-skeleton" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[330px] w-full rounded-lg bg-skeleton lg:col-span-2" />
        <Skeleton className="h-[330px] w-full rounded-lg bg-skeleton" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[300px] w-full rounded-lg bg-skeleton" />
        <Skeleton className="h-[300px] w-full rounded-lg bg-skeleton" />
        <Skeleton className="h-[300px] w-full rounded-lg bg-skeleton" />
      </div>
    </div>
  );
}
