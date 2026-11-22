"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SourcePanel } from "@/components/documents/source-panel";
import { ProblemAlert } from "@/components/shared/problem-alert";
import { StatusChip } from "@/components/shared/status-chip";
import { ErrorState } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { ApiProblem, fieldErrors, invalidIdAsMissing } from "@/lib/api/problem";
import type { InvoiceOut } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import {
  FIELD_GROUPS,
  FIELD_LABELS,
  errorIssues,
  fieldValue,
  type FieldName,
} from "@/lib/invoices";
import { documentOptions, invoiceOptions, queueOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";
import { useShortcuts } from "@/lib/shortcuts";
import { CorrectionsPanel } from "./corrections-panel";
import { FieldRow } from "./field-row";
import { IssuesBanner } from "./issues-banner";
import { LineItems } from "./line-items";
import { useApproveInvoice, useCorrectInvoice } from "./use-invoice-actions";

type Tab = "fields" | "source" | "issues";

/** Mounted only once the invoice is loaded, so its handlers always see the current invoice. */
function InvoiceShortcuts({ handlers }: { handlers: Record<string, () => void> }) {
  useShortcuts(handlers);
  return null;
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-line bg-surface", className)}>
      <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const pageLabel = (pages: number[] | null) =>
  !pages || pages.length === 0
    ? null
    : pages.length === 1
      ? `p.${pages[0]}`
      : `p.${pages[0]}–${pages[pages.length - 1]}`;

const pagesText = (pages: number[] | null) =>
  !pages || pages.length === 0
    ? ""
    : pages.length === 1
      ? `, page ${pages[0]}`
      : `, pages ${pages[0]}–${pages[pages.length - 1]}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the re-run of the checks found, in one sentence. */
function revalidationMessage(label: string, before: InvoiceOut | undefined, after: InvoiceOut): string {
  const was = before?.issues.length ?? 0;
  const now = after.issues.length;
  const state = now === 0 ? "all checks pass" : `${plural(now, "issue", "issues")} open`;
  const change = was !== now ? ` (was ${was})` : "";
  const status = after.status === "approved" ? "Approved" : after.status === "ready" ? "Ready" : "Needs review";
  return `Saved ${label.toLowerCase()}. Checks re-run: ${state}${change}. Status: ${status}.`;
}

export function InvoiceDetail({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const inQueue = useSearchParams().get("queue") === "1";

  const invoiceQuery = useQuery(invoiceOptions(api, id));
  const invoice = invoiceQuery.data;
  const documentId = invoice?.document_id;
  const docQuery = useQuery({ ...documentOptions(api, documentId ?? ""), enabled: Boolean(documentId) });
  const queue = useQuery({ ...queueOptions(api), enabled: inQueue });

  const [tab, setTab] = useState<Tab>("fields");
  const [sourcePage, setSourcePage] = useState<number | undefined>(undefined);
  const [saved, setSaved] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [savingField, setSavingField] = useState<FieldName | null>(null);

  const correct = useCorrectInvoice(id);
  const approve = useApproveInvoice(id);

  if (invoiceQuery.isPending) return <InvoiceDetailSkeleton />;
  if (invoiceQuery.error && !invoice) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState error={invalidIdAsMissing(invoiceQuery.error, id)} onRetry={() => void invoiceQuery.refetch()} />
      </div>
    );
  }
  if (!invoice) return null;

  const errors = errorIssues(invoice);
  const approved = invoice.status === "approved";
  const blocked = errors.length > 0;
  const pages = invoice.page_numbers;
  const queueIds = queue.data?.items.map((i) => i.id) ?? [];
  const position = queueIds.indexOf(id);
  const prevId = position > 0 ? queueIds[position - 1] : undefined;
  const nextId = position >= 0 ? queueIds[position + 1] : queueIds[0];
  const hrefFor = (target: string) => `/invoices/${target}?queue=1`;

  function goToField(name: string) {
    setTab("fields");
    // The tab panel is shown on the next frame; focus then.
    requestAnimationFrame(() => {
      const el = document.getElementById(`field-${name}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus();
    });
  }

  function save(name: FieldName, label: string, value: string | null) {
    setSaved(null);
    setServerErrors({});
    setSavingField(name);
    const before = queryClient.getQueryData(invoiceOptions(api, id).queryKey);
    correct.mutate(
      { field: name, value },
      {
        onSuccess: (after) => setSaved(revalidationMessage(label, before, after)),
        onError: (error) => {
          if (error instanceof ApiProblem && error.status === 422) setServerErrors(fieldErrors(error));
        },
        onSettled: () => setSavingField(null),
      },
    );
  }

  function doApprove() {
    approve.mutate(undefined, {
      onSuccess: () => {
        toast.success("Invoice approved");
        if (inQueue) {
          // Approving a clean invoice moves straight on to the next one in the queue.
          if (nextId) router.push(hrefFor(nextId));
          else router.push("/review");
        }
      },
    });
  }

  const sourceDoc = docQuery.data;
  const shortcuts: Record<string, () => void> = {
    // J and K walk the review queue; A approves when nothing blocks it; E edits the focused field.
    j: () => inQueue && nextId && router.push(hrefFor(nextId)),
    k: () => inQueue && prevId && router.push(hrefFor(prevId)),
    a: () => {
      if (!approved && !blocked && !approve.isPending) doApprove();
    },
    e: () => {
      const el = document.activeElement;
      if (el instanceof HTMLButtonElement && el.id.startsWith("field-")) el.click();
    },
  };
  const issuesLabel = `Issues${invoice.issues.length ? ` ${invoice.issues.length}` : ""}`;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
      <InvoiceShortcuts handlers={shortcuts} />
      <Link
        href={inQueue ? "/review" : "/invoices"}
        className="inline-flex w-fit items-center gap-1 text-[13px] text-link hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> {inQueue ? "Review queue" : "Invoices"}
      </Link>

      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="min-w-0 truncate font-mono text-xl font-semibold">
              {invoice.invoice_number ?? "No invoice number"}
            </h2>
            <StatusChip status={invoice.status} />
          </div>
          <p className="mt-1 text-[13px] text-ink-2" suppressHydrationWarning>
            {invoice.supplier_name ?? "Supplier not found"}
            {invoice.invoice_date ? ` · ${formatDate(invoice.invoice_date)}` : ""}
            {sourceDoc && (
              <>
                {" · from "}
                <Link href={`/documents/${sourceDoc.id}`} className="text-link hover:underline">
                  {sourceDoc.filename}
                </Link>
                {pagesText(pages)}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          {inQueue && (
            <div className="flex items-center gap-1" aria-label="Queue navigation">
              <span className="mr-1 text-xs text-ink-2 tabular-nums">
                {position >= 0 ? `${position + 1} of ${queueIds.length} in queue` : `${queueIds.length} in queue`}
              </span>
              <Button asChild={Boolean(prevId)} variant="outline" size="icon-sm" disabled={!prevId} aria-label="Previous in queue">
                {prevId ? (
                  <Link href={hrefFor(prevId)}>
                    <ChevronLeft aria-hidden="true" />
                  </Link>
                ) : (
                  <ChevronLeft aria-hidden="true" />
                )}
              </Button>
              <Button asChild={Boolean(nextId)} variant="outline" size="icon-sm" disabled={!nextId} aria-label="Next in queue">
                {nextId ? (
                  <Link href={hrefFor(nextId)}>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </Button>
            </div>
          )}
          <Button
            onClick={doApprove}
            title="Approve invoice (A)"
            disabled={approved || blocked || approve.isPending}
            aria-describedby={blocked ? "approve-hint" : undefined}
          >
            <Check aria-hidden="true" /> {approved ? "Approved" : approve.isPending ? "Approving" : "Approve invoice"}
          </Button>
        </div>
        {blocked && !approved && (
          <p id="approve-hint" className="basis-full text-right text-xs text-ink-2">
            Resolve {plural(errors.length, "error", "errors")} to approve this invoice.
          </p>
        )}
      </header>

      {approve.error && <ProblemAlert error={approve.error} />}
      {correct.error && <ProblemAlert error={correct.error} />}
      <p role="status" className="min-h-0 text-[13px] text-ok empty:hidden">
        {saved}
      </p>
      <p className="hidden text-xs text-ink-3 lg:block">
        Shortcuts: {inQueue ? "J next, K previous, " : ""}A approve, E edit the focused field, / search.
      </p>

      <div role="tablist" aria-label="Invoice sections" className="flex gap-1 border-b border-line lg:hidden">
        {(
          [
            ["fields", "Fields"],
            ["source", "Source"],
            ["issues", issuesLabel],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            data-focus-inset
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] outline-none",
              tab === key ? "border-primary font-semibold text-ink" : "border-transparent text-ink-2",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={cn(tab !== "issues" && "max-lg:hidden")}>
        <IssuesBanner issues={invoice.issues} onGoToField={goToField} />
        {invoice.issues.length === 0 && (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-2 lg:hidden">
            No validation issues.
          </p>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Source" className={cn(tab !== "source" && "max-lg:hidden")}>
          <div className="p-4">
            {sourceDoc ? (
              <SourcePanel
                documentId={sourceDoc.id}
                filename={sourceDoc.filename}
                pageNumbers={pages}
                page={sourcePage}
                onPageChange={setSourcePage}
              />
            ) : (
              <Skeleton className="h-[380px] w-full bg-skeleton" role="status" aria-label="Loading source" />
            )}
          </div>
        </Section>

        <div className={cn("flex flex-col gap-4", tab !== "fields" && "max-lg:hidden")}>
          <Section title="Extracted fields">
            <div className="divide-y divide-line">
              {FIELD_GROUPS.map((group) => (
                <div key={group.title} role="group" aria-label={group.title}>
                  <h3 className="bg-surface-2 px-4 py-1.5 text-xs font-medium text-ink-2">{group.title}</h3>
                  {group.fields.map((def) => (
                    <FieldRow
                      key={def.name}
                      def={def}
                      value={fieldValue(invoice, def.name)}
                      confidence={invoice.confidence[def.name]}
                      edited={invoice.corrected_fields.includes(def.name)}
                      pageLabel={pageLabel(pages)}
                      issues={invoice.issues.filter((i) => i.field === def.name)}
                      saving={savingField === def.name && correct.isPending}
                      serverError={serverErrors[def.name]}
                      onSave={(value) => save(def.name, def.label, value)}
                      onShowPage={() => {
                        const first = pages?.[0];
                        if (first !== undefined) setSourcePage(first);
                        setTab("source");
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>

      <Section title="Line items">
        <LineItems invoice={invoice} />
      </Section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Corrections history">
          <CorrectionsPanel corrections={invoice.corrections} />
        </Section>
        <Section title="Extraction details">
          <dl className="grid grid-cols-[112px_minmax(0,1fr)] gap-y-1.5 px-4 py-3 text-[13px]">
            <dt className="text-ink-2">Method</dt>
            <dd>{invoice.method ?? "Not recorded"}</dd>
            <dt className="text-ink-2">Model</dt>
            <dd className="break-all">{invoice.model ?? "Not recorded"}</dd>
            <dt className="text-ink-2">Edited fields</dt>
            <dd>
              {invoice.corrected_fields.length > 0
                ? invoice.corrected_fields.map((f) => FIELD_LABELS[f] ?? f).join(", ")
                : "None"}
            </dd>
          </dl>
        </Section>
      </div>
    </div>
  );
}

/** Same blocks as the page: back link, header, issues, split view, line items. */
export function InvoiceDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4" aria-busy="true">
      <Skeleton className="h-4 w-28 bg-skeleton" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-56 bg-skeleton" />
          <Skeleton className="h-4 w-80 bg-skeleton" />
        </div>
        <Skeleton className="h-9 w-36 bg-skeleton" />
      </div>
      <Skeleton className="h-24 w-full rounded-lg bg-skeleton" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[520px] w-full rounded-lg bg-skeleton" />
        <Skeleton className="h-[520px] w-full rounded-lg bg-skeleton" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg bg-skeleton" />
    </div>
  );
}
