"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, RotateCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { ArchivedNotice } from "@/components/shared/archived-notice";
import { RefreshButton } from "@/components/shared/refresh-button";
import { useConfirmedActions } from "@/components/shared/use-confirmed-actions";
import { StatusChip } from "@/components/shared/status-chip";
import { ErrorState } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { ApiProblem, describeError, invalidIdAsMissing } from "@/lib/api/problem";
import type { DocumentOut } from "@/lib/api/types";
import { formatBytes } from "@/lib/format";
import { formatWhen, isActive, stageText, typeTile } from "@/lib/documents";
import { documentInvoicesOptions, documentOptions } from "@/lib/query/options";
import { useBackoffInterval } from "@/lib/query/polling";
import { EventsTable } from "./events-table";
import { InvoicesFound } from "./invoices-found";
import { IssuesInFile } from "./issues-in-file";
import { SourcePanel } from "./source-panel";

const active = (d: DocumentOut) => isActive(d);
const signature = (d: DocumentOut) => `${d.status}:${d.progress}:${d.current_stage ?? ""}`;

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="overflow-clip rounded-lg border border-line bg-surface">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

/** Hidden until the file has issues, so a clean file shows no empty section. */
function IssuesSection({ documentId, archived }: { documentId: string; archived: boolean }) {
  const { data } = useQuery(documentInvoicesOptions(api, documentId, archived));
  const count = data?.items.reduce((sum, inv) => sum + inv.issues.length, 0) ?? 0;
  if (count === 0) return null;
  return (
    <Section
      title={`Issues in this file (${count})`}
      action={<RefreshButton label="Refresh issues" queryKeys={[["invoices", "by-document", documentId]]} />}
    >
      <IssuesInFile documentId={documentId} archived={archived} />
    </Section>
  );
}

export function DocumentDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const refetchInterval = useBackoffInterval(active, signature);
  const { data: doc, error, isPending, refetch } = useQuery({ ...documentOptions(api, id), refetchInterval });
  const actions = useConfirmedActions();

  const status = doc?.status;
  const stage = doc?.current_stage;
  // New stage or a finished run means new events, pages and invoices: refresh them.
  useEffect(() => {
    if (!status) return;
    void queryClient.invalidateQueries({ queryKey: ["documents", "events", id] });
    void queryClient.invalidateQueries({ queryKey: ["invoices", "by-document", id] });
    void queryClient.invalidateQueries({ queryKey: ["documents", "pages", id] });
  }, [status, stage, id, queryClient]);

  if (isPending) return <DocumentDetailSkeleton />;
  if (error && !doc) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState error={invalidIdAsMissing(error, id)} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (!doc) return null;

  const running = isActive(doc);
  const archived = Boolean(doc.archived_at);
  // A failed file that never produced a page has no invoices and nothing to show as a source.
  const noPages = doc.status === "failed" && !doc.page_count;
  const paused = error instanceof ApiProblem && error.status === 429;
  const waiting = running ? "Not available while this file is processing" : undefined;

  return (
    <>
    <PageHeader
      crumbs={[
        archived ? { label: "Archived", href: "/archived" } : { label: "Documents", href: "/documents" },
        { label: doc.filename },
      ]}
      title={<span title={doc.filename}>{doc.filename}</span>}
      meta={<StatusChip status={doc.status} />}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={running || archived || actions.isBusy("reprocess", id)}
            title={archived ? "Restore the document to reprocess it" : waiting}
            onClick={() => actions.askReprocess(id, doc.filename)}
          >
            <RotateCw aria-hidden="true" /> Reprocess
          </Button>
          {archived ? (
            <Button
              variant="outline"
              size="sm"
              disabled={running || actions.isBusy("document", id)}
              title={waiting}
              onClick={() => void actions.restore("document", id, doc.filename)}
            >
              <ArchiveRestore aria-hidden="true" /> Restore
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={running || actions.isBusy("document", id)}
              title={waiting}
              onClick={() => actions.askArchive("document", id, doc.filename)}
            >
              <Archive aria-hidden="true" /> Archive
            </Button>
          )}
        </>
      }
    />
    {actions.dialog}
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span
          aria-hidden="true"
          className="flex h-[42px] w-9 flex-none items-end justify-center rounded-sm border border-line-strong bg-surface pb-1.5 font-mono text-[9px] font-semibold text-ink-2"
        >
          {typeTile(doc.file_type)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink-2" suppressHydrationWarning>
            {formatBytes(doc.size_bytes)}
            {doc.page_count ? ` · ${doc.page_count} ${doc.page_count === 1 ? "page" : "pages"}` : ""}
            {` · Uploaded ${formatWhen(doc.created_at)}`}
          </p>
          {running && (
            <div className="mt-2 flex max-w-sm flex-col gap-1.5" role="status">
              <span className="text-[13px] text-ink-2">
                {stageText(doc)} <span className="text-ink-3 tabular-nums">{doc.progress}%</span>
              </span>
              <div
                role="progressbar"
                aria-label="Processing progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={doc.progress}
                className="h-0.5 rounded-full bg-skeleton"
              >
                <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${doc.progress}%` }} />
              </div>
            </div>
          )}
          {paused && (
            <p role="status" className="mt-2 text-xs text-ink-3">
              Live updates paused. {describeError(error).message}
            </p>
          )}
        </div>
      </header>

      {doc.status === "failed" && (
        <Alert variant="destructive" className="border-danger/40 bg-danger-bg">
          <AlertTitle className="text-danger">This file could not be processed</AlertTitle>
          <AlertDescription className="text-ink">
            <p>{doc.error ?? "No reason was recorded."}</p>
            <p>Reprocess only helps if the problem was temporary. Otherwise upload a new copy of the file.</p>
            <Button asChild variant="outline" size="sm" className="mt-2 text-ink">
              <Link href="/documents">Upload a new copy</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {archived && (
        <ArchivedNotice
          title="This document is archived"
          restoring={actions.isBusy("document", id)}
          restoreLabel="Restore document"
          onRestore={() => void actions.restore("document", id, doc.filename)}
        >
          It and its invoices are hidden from lists, search, the review queue and the dashboard numbers, and no longer
          count as duplicates. Nothing was deleted. Restore it to edit, approve or reprocess.
        </ArchivedNotice>
      )}

      {!noPages && (
        <Section
          title="Invoices found"
          action={<RefreshButton label="Refresh invoices found" queryKeys={[["invoices", "by-document", id]]} />}
        >
          <InvoicesFound documentId={id} status={doc.status} archived={archived} />
        </Section>
      )}

      {!noPages && <IssuesSection documentId={id} archived={archived} />}

      {!noPages && (
        <Section title="Source">
          <div className="p-4">
            <SourcePanel documentId={id} filename={doc.filename} />
          </div>
        </Section>
      )}

      <Section title="Processing history">
        <EventsTable documentId={id} />
      </Section>
    </div>
    </>
  );
}

/** Same blocks as the page: back link, header, three sections. */
export function DocumentDetailSkeleton() {
  return (
    <>
    <PageHeader
      crumbs={[{ label: "Documents", href: "/documents" }, { label: "Document" }]}
      title={<Skeleton className="h-6 w-72 bg-skeleton" />}
    />
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5" aria-busy="true">
      <div className="flex items-start gap-4">
        <Skeleton className="h-[42px] w-9 bg-skeleton" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-56 bg-skeleton" />
        </div>
      </div>
      <Skeleton className="h-36 w-full rounded-lg bg-skeleton" />
      <Skeleton className="h-[460px] w-full rounded-lg bg-skeleton" />
      <Skeleton className="h-44 w-full rounded-lg bg-skeleton" />
    </div>
    </>
  );
}
