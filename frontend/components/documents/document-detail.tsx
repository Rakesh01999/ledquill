"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProblemAlert } from "@/components/shared/problem-alert";
import { StatusChip } from "@/components/shared/status-chip";
import { ErrorState } from "@/components/shared/states";
import { api, unwrap } from "@/lib/api/client";
import { ApiProblem, describeError } from "@/lib/api/problem";
import type { DocumentOut } from "@/lib/api/types";
import { formatBytes } from "@/lib/format";
import { formatWhen, isActive, stageText, typeTile } from "@/lib/documents";
import { documentOptions } from "@/lib/query/options";
import { useBackoffInterval } from "@/lib/query/polling";
import { EventsTable } from "./events-table";
import { InvoicesFound } from "./invoices-found";
import { SourcePanel } from "./source-panel";

const active = (d: DocumentOut) => isActive(d);
const signature = (d: DocumentOut) => `${d.status}:${d.progress}:${d.current_stage ?? ""}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

export function DocumentDetail({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const refetchInterval = useBackoffInterval(active, signature);
  const { data: doc, error, isPending, refetch } = useQuery({ ...documentOptions(api, id), refetchInterval });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const status = doc?.status;
  const stage = doc?.current_stage;
  // New stage or a finished run means new events, pages and invoices: refresh them.
  useEffect(() => {
    if (!status) return;
    void queryClient.invalidateQueries({ queryKey: ["documents", "events", id] });
    void queryClient.invalidateQueries({ queryKey: ["invoices", "by-document", id] });
    void queryClient.invalidateQueries({ queryKey: ["documents", "pages", id] });
  }, [status, stage, id, queryClient]);

  const reprocess = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/v1/documents/{document_id}/reprocess", { params: { path: { document_id: id } } })),
    onSuccess: () => {
      toast.success("Reprocessing queued");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      unwrap(api.DELETE("/api/v1/documents/{document_id}", { params: { path: { document_id: id } } })),
    onSuccess: () => {
      toast.success("Document deleted");
      setConfirmDelete(false);
      queryClient.removeQueries({ queryKey: ["documents", "detail", id] });
      void queryClient.invalidateQueries({ queryKey: ["documents", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      router.push("/documents");
    },
  });

  if (isPending) return <DocumentDetailSkeleton />;
  if (error && !doc) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (!doc) return null;

  const running = isActive(doc);
  const paused = error instanceof ApiProblem && error.status === 429;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
      <Link href="/documents" className="inline-flex w-fit items-center gap-1 text-[13px] text-link hover:underline">
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Documents
      </Link>

      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span
          aria-hidden="true"
          className="flex h-[42px] w-9 flex-none items-end justify-center rounded-sm border border-line-strong bg-surface pb-1.5 font-mono text-[9px] font-semibold text-ink-2"
        >
          {typeTile(doc.file_type)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="min-w-0 truncate text-xl font-semibold" title={doc.filename}>
              {doc.filename}
            </h2>
            <StatusChip status={doc.status} />
          </div>
          <p className="mt-1 text-[13px] text-ink-2" suppressHydrationWarning>
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
        <div className="flex flex-none items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={running || reprocess.isPending}
            onClick={() => reprocess.mutate()}
          >
            <RotateCw aria-hidden="true" /> Reprocess
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-danger hover:text-danger"
            onClick={() => {
              remove.reset();
              setConfirmDelete(true);
            }}
          >
            <Trash2 aria-hidden="true" /> Delete
          </Button>
        </div>
      </header>

      {doc.status === "failed" && (
        <Alert variant="destructive" className="border-danger/40 bg-danger-bg">
          <AlertTitle className="text-danger">This file could not be processed</AlertTitle>
          <AlertDescription className="text-ink">
            {doc.error ?? "No reason was recorded."} Choose Reprocess to try again, or delete the document and upload a corrected file.
          </AlertDescription>
        </Alert>
      )}
      {reprocess.error && <ProblemAlert error={reprocess.error} />}

      <Section title="Invoices found">
        <InvoicesFound documentId={id} status={doc.status} />
      </Section>

      <Section title="Source">
        <div className="p-4">
          <SourcePanel documentId={id} filename={doc.filename} />
        </div>
      </Section>

      <Section title="Processing history">
        <EventsTable documentId={id} />
      </Section>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              {doc.filename} and everything extracted from it will be removed: invoices, corrections, processing
              history and the stored file. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {remove.error && <ProblemAlert error={remove.error} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? "Deleting" : "Delete document"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Same blocks as the page: back link, header, three sections. */
export function DocumentDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5" aria-busy="true">
      <Skeleton className="h-4 w-24 bg-skeleton" />
      <div className="flex items-start gap-4">
        <Skeleton className="h-[42px] w-9 bg-skeleton" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-72 bg-skeleton" />
          <Skeleton className="h-4 w-56 bg-skeleton" />
        </div>
      </div>
      <Skeleton className="h-36 w-full rounded-lg bg-skeleton" />
      <Skeleton className="h-[460px] w-full rounded-lg bg-skeleton" />
      <Skeleton className="h-44 w-full rounded-lg bg-skeleton" />
    </div>
  );
}
