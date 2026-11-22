"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import type { EventOut } from "@/lib/api/types";
import { formatDuration, formatWhen, stageLabel } from "@/lib/documents";
import { eventsOptions } from "@/lib/query/options";

const head = "text-xs font-medium text-ink-2";

function Result({ status }: { status: string }) {
  if (status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 text-ok">
        <CircleCheck className="size-3.5" aria-hidden="true" /> Succeeded
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <CircleAlert className="size-3.5" aria-hidden="true" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-ink-2">
      <Clock className="size-3.5" aria-hidden="true" /> In progress
    </span>
  );
}

/**
 * The API records a "started" and a "succeeded"/"failed" event per step. Show one row per step
 * run: the last event wins, so a step that is still running reads "In progress".
 */
function oneRowPerStep(events: EventOut[]): EventOut[] {
  const rows = new Map<string, EventOut>();
  for (const e of events) rows.set(`${e.job_id ?? "-"}:${e.stage}`, e);
  return [...rows.values()];
}

/** A short note from the event detail: the failure reason, or that the stage was skipped. */
function note(event: EventOut): string {
  const detail = event.detail;
  if (!detail) return "";
  if (typeof detail.error === "string") return detail.error;
  if (typeof detail.skipped === "string") return `Skipped: ${detail.skipped}`;
  if (detail.skipped === true) return "Skipped";
  return "";
}

export function EventsTable({ documentId }: { documentId: string }) {
  const { data, isPending, error, refetch } = useQuery(eventsOptions(api, documentId));
  if (isPending) return <TableSkeleton rows={4} widths={["w-32", "w-24", "w-16", "w-20"]} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const rows = oneRowPerStep(data.items);
  if (rows.length === 0) return <EmptyState title="No processing steps recorded yet." />;
  return (
    <Table className="min-w-[560px]">
      <TableHeader className="bg-surface-2 [&_tr]:border-line">
        <TableRow className="h-9 hover:bg-transparent">
          <TableHead className={`pl-4 ${head}`}>Step</TableHead>
          <TableHead className={head}>Result</TableHead>
          <TableHead className={`text-right ${head}`}>Duration</TableHead>
          <TableHead className={head}>When</TableHead>
          <TableHead className={`pr-4 ${head}`}>Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((e, i) => (
          <TableRow key={`${e.stage}-${e.status}-${e.created_at}-${i}`} className="h-10 border-line hover:bg-surface-2/60">
            <TableCell className="pl-4 font-medium">{stageLabel(e.stage)}</TableCell>
            <TableCell>
              <Result status={e.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatDuration(e.duration_ms)}</TableCell>
            <TableCell className="text-ink-2" suppressHydrationWarning>
              {formatWhen(e.created_at)}
            </TableCell>
            <TableCell className="max-w-64 truncate pr-4 text-ink-2" title={note(e) || undefined}>
              {note(e)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
