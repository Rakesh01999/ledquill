"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { formatDuration, stageLabel } from "@/lib/documents";
import { statsOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";

const STAGE_ORDER = ["detect", "extract", "split", "fields", "validate", "index"];

const percent = (rate: number | null): string | null =>
  rate === null ? null : `${(rate * 100).toLocaleString("en", { maximumFractionDigits: 1 })}%`;

function Figure({ label, value, note, href }: { label: string; value: string | null; note?: string; href?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="text-2xl leading-none font-semibold tabular-nums">
        {value ?? <span className="text-ink-3">—</span>}
      </dd>
      <dd className="min-h-4 text-xs text-ink-3">
        {href ? (
          <Link href={href} className="text-link hover:underline">
            {note}
          </Link>
        ) : (
          note
        )}
      </dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const head = "text-xs font-medium text-ink-2";

function CountTable({ rows, label }: { rows: { name: string; count: number; href: string }[]; label: string }) {
  return (
    <Table>
      <TableHeader className="bg-surface-2 [&_tr]:border-line">
        <TableRow className="h-9 hover:bg-transparent">
          <TableHead className={cn("pl-4", head)}>{label}</TableHead>
          <TableHead className={cn("pr-4 text-right", head)}>Count</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name} className="h-10 border-line hover:bg-surface-2/60">
            <TableCell className="pl-4">
              <Link href={r.href} className="text-link hover:underline">
                {r.name}
              </Link>
            </TableCell>
            <TableCell className="pr-4 text-right tabular-nums">{r.count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Pipeline health. Every number comes from /stats, the same source as the review badge. */
export function DashboardView() {
  const { data, error, isPending, refetch } = useQuery(statsOptions(api));

  if (isPending) return <DashboardSkeleton />;
  if (error && !data) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (!data) return null;

  if (data.documents.total === 0) {
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

  const d = data.documents.by_status;
  const i = data.invoices.by_status;
  const stages = Object.entries(data.avg_stage_ms).sort(
    ([a], [b]) => (STAGE_ORDER.indexOf(a) + 1 || 99) - (STAGE_ORDER.indexOf(b) + 1 || 99),
  );
  const noFinished = data.success_rate === null;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
      <section aria-label="Pipeline figures" className="overflow-hidden rounded-lg border border-line bg-surface">
        <dl className="grid grid-cols-2 divide-line max-sm:divide-y sm:grid-cols-3 sm:divide-x lg:grid-cols-5">
          <Figure label="Documents processed" value={String(data.documents.total)} note="All uploads" href="/documents" />
          <Figure
            label="Success rate"
            value={percent(data.success_rate)}
            note={noFinished ? "No finished documents yet" : `${d.completed ?? 0} completed`}
          />
          <Figure
            label="Failure rate"
            value={percent(data.failure_rate)}
            note={noFinished ? "No finished documents yet" : `${d.failed ?? 0} failed`}
            href={!noFinished && (d.failed ?? 0) > 0 ? "/documents?status=failed" : undefined}
          />
          <Figure label="Awaiting review" value={String(data.needs_review)} note="Open the queue" href="/review" />
          <Figure
            label="Average processing time"
            value={
              data.avg_processing_seconds === null
                ? null
                : `${data.avg_processing_seconds.toLocaleString("en", { maximumFractionDigits: 1 })} s`
            }
            note={data.avg_processing_seconds === null ? "No completed jobs yet" : "Per completed document"}
          />
        </dl>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel title="Documents by status">
          <CountTable
            label="Status"
            rows={[
              { name: "Queued", count: d.queued ?? 0, href: "/documents?status=queued" },
              { name: "Processing", count: d.processing ?? 0, href: "/documents?status=processing" },
              { name: "Completed", count: d.completed ?? 0, href: "/documents?status=completed" },
              { name: "Failed", count: d.failed ?? 0, href: "/documents?status=failed" },
            ]}
          />
        </Panel>
        <Panel title="Invoices by status">
          <CountTable
            label="Status"
            rows={[
              { name: "Needs review", count: i.needs_review ?? 0, href: "/review" },
              { name: "Ready", count: i.ready ?? 0, href: "/invoices?status=ready" },
              { name: "Approved", count: i.approved ?? 0, href: "/invoices?status=approved" },
            ]}
          />
        </Panel>
        <Panel title="Average time per step">
          {stages.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-2">No steps have finished yet.</p>
          ) : (
            <Table>
              <TableHeader className="bg-surface-2 [&_tr]:border-line">
                <TableRow className="h-9 hover:bg-transparent">
                  <TableHead className={cn("pl-4", head)}>Step</TableHead>
                  <TableHead className={cn("pr-4 text-right", head)}>Average</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stages.map(([stage, ms]) => (
                  <TableRow key={stage} className="h-10 border-line hover:bg-transparent">
                    <TableCell className="pl-4">{stageLabel(stage)}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{formatDuration(Math.round(ms))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Same blocks as the page: the figures strip and three tables. */
export function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4" aria-busy="true">
      <Skeleton className="h-[98px] w-full rounded-lg bg-skeleton" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[218px] w-full rounded-lg bg-skeleton" />
        <Skeleton className="h-[218px] w-full rounded-lg bg-skeleton" />
        <Skeleton className="h-[298px] w-full rounded-lg bg-skeleton" />
      </div>
    </div>
  );
}
