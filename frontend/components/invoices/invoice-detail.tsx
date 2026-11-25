"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, CircleHelp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SourcePanel } from "@/components/documents/source-panel";
import { PageHeader } from "@/components/shared/page-header";
import { ProblemAlert } from "@/components/shared/problem-alert";
import { StatusChip } from "@/components/shared/status-chip";
import { ErrorState } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { ApiProblem, describeError, fieldErrors, invalidIdAsMissing } from "@/lib/api/problem";
import type { InvoiceOut } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import {
  FIELD_GROUPS,
  FIELD_LABELS,
  errorIssues,
  fieldValue,
  type FieldName,
} from "@/lib/invoices";
import { documentInvoicesOptions, documentOptions, invoiceOptions, queueOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";
import { useShortcuts } from "@/lib/shortcuts";
import { CorrectionsPanel } from "./corrections-panel";
import { FieldRow, type SaveResult } from "./field-row";
import { FileIssuesLine } from "./file-issues-line";
import { IssuesBanner } from "./issues-banner";
import { LineItems } from "./line-items";
import { useApproveInvoice, useCorrectInvoice } from "./use-invoice-actions";

type Tab = "fields" | "source" | "issues";

/** Mounted only once the invoice is loaded, so its handlers always see the current invoice. */
function InvoiceShortcuts({ handlers }: { handlers: Record<string, () => void> }) {
  useShortcuts(handlers);
  return null;
}

function Section({
  title,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-line bg-surface", className)}>
      <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold">{title}</h2>
      <div className={cn("overflow-x-auto", bodyClassName)}>{children}</div>
    </section>
  );
}

/** The page chip is only useful when the invoice spans several pages: one page needs no pointer. */
const pageLabel = (pages: number[] | null) =>
  !pages || pages.length < 2 ? null : `p.${pages[0]}–${pages[pages.length - 1]}`;

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
  const siblings = useQuery({ ...documentInvoicesOptions(api, documentId ?? ""), enabled: Boolean(documentId) });

  const [tab, setTab] = useState<Tab>("fields");
  const [sourcePage, setSourcePage] = useState<number | undefined>(undefined);
  const [saved, setSaved] = useState<string | null>(null);

  const correct = useCorrectInvoice(id);
  const approve = useApproveInvoice(id);

  // A link ending in #issues (from the documents list) lands on the Issues section. The hash is read
  // here, after the invoice has rendered, never during render, so server and client markup match.
  const loaded = Boolean(invoice);
  // The field a "Go to <field>" button pointed at. `n` makes a second click on the same field count.
  const [target, setTarget] = useState<{ name: string; n: number } | null>(null);
  useEffect(() => {
    if (!target) return;
    // Runs after the commit that shows the Fields tab, so the row exists and has a layout (below lg too).
    const el = document.getElementById(`field-${target.name}`);
    if (el) {
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
      // preventScroll: a plain focus() cancels the smooth scroll above when the field is already in view.
      el.focus({ preventScroll: true });
    }
    const timer = setTimeout(() => setTarget(null), 1800);
    return () => clearTimeout(timer);
  }, [target]);
  // The issue a field marker pointed at; below lg the banner is a tab, so it is opened first.
  const [issueTarget, setIssueTarget] = useState<{ index: number; n: number } | null>(null);
  useEffect(() => {
    if (!issueTarget) return;
    const el = document.getElementById(`issue-${issueTarget.index}`);
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }, [issueTarget]);
  const landOnIssues = useRef(false);
  useEffect(() => {
    if (!loaded || window.location.hash !== "#issues") return;
    landOnIssues.current = true;
    // Below lg the section is a tab, so open it first; on desktop this changes nothing visible.
    const frame = requestAnimationFrame(() => setTab("issues"));
    return () => cancelAnimationFrame(frame);
  }, [loaded]);
  // Runs once the Issues tab is on screen: scroll to the section and move focus to it.
  useEffect(() => {
    if (!landOnIssues.current || tab !== "issues") return;
    landOnIssues.current = false;
    const el = document.getElementById("issues");
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }, [tab]);

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
  const fileItems = siblings.data?.items ?? [];
  const fileIndex = fileItems.findIndex((i) => i.id === id);
  const filePosition =
    fileItems.length >= 2 && fileIndex >= 0 ? `Invoice ${fileIndex + 1} of ${fileItems.length} in this file` : null;
  const showIssue = (field: string) => {
    const index = invoice.issues.findIndex((i) => i.field === field);
    if (index < 0) return;
    setTab("issues");
    setIssueTarget((t) => ({ index, n: (t?.n ?? 0) + 1 }));
  };
  const hrefFor = (target: string) => `/invoices/${target}?queue=1`;

  /** Show the Fields tab and mark the field; the effect above scrolls once the row is on screen. */
  function goToField(name: string) {
    setTab("fields");
    setTarget({ name, n: (target?.n ?? 0) + 1 });
  }

  /** Resolves when the server has answered; the field closes its editor only on success. */
  async function save(name: FieldName, label: string, value: string | null): Promise<SaveResult> {
    setSaved(null);
    const before = queryClient.getQueryData(invoiceOptions(api, id).queryKey);
    try {
      const after = await correct.mutateAsync({ field: name, value });
      setSaved(revalidationMessage(label, before, after));
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        const message = fieldErrors(error)[name] ?? error.errors[0]?.msg;
        if (message) return { ok: false, error: message };
      }
      const { title, message } = describeError(error);
      return { ok: false, error: `${title}. ${message}` };
    }
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
  const shortcutRows: [string, string][] = [
    ...(inQueue
      ? ([
          ["J", "Next in queue"],
          ["K", "Previous in queue"],
        ] as [string, string][])
      : []),
    ["A", "Approve invoice"],
    ["E", "Edit the focused field"],
    ["/", "Search"],
  ];
  const issuesLabel = `Issues${invoice.issues.length ? ` ${invoice.issues.length}` : ""}`;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: inQueue ? "Review queue" : "Invoices", href: inQueue ? "/review" : "/invoices" },
          { label: invoice.invoice_number ?? "No invoice number" },
        ]}
        title={invoice.invoice_number ?? "No invoice number"}
        titleClassName="font-mono"
        meta={
          <>
            <StatusChip status={invoice.status} />
            {invoice.issues.length > 0 && (
              <span className="text-[13px] font-medium">
                <span className={errors.length > 0 ? "text-danger" : "text-ink-2"}>
                  {plural(errors.length, "error", "errors")}
                </span>
                <span className="text-ink-2">, {plural(invoice.issues.length - errors.length, "warning", "warnings")}</span>
              </span>
            )}
          </>
        }
        actions={
        <div className="flex flex-none flex-col items-start gap-1.5 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="max-lg:hidden" aria-label="Keyboard shortcuts">
                  <CircleHelp aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end">
                <ul className="flex flex-col gap-1">
                  {shortcutRows.map(([key, what]) => (
                    <li key={key} className="flex items-center gap-2">
                      <kbd className="min-w-5 rounded-sm border border-background/40 px-1 text-center font-mono text-[11px]">
                        {key}
                      </kbd>
                      {what}
                    </li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
            <Button
              onClick={doApprove}
              title="Approve invoice (A)"
              disabled={approved || blocked || approve.isPending}
              aria-describedby={blocked ? "approve-hint" : undefined}
            >
              <Check aria-hidden="true" /> {approved ? "Approved" : approve.isPending ? "Approving" : "Approve invoice"}
            </Button>
          </div>
        </div>
        }
      />
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
      <InvoiceShortcuts handlers={shortcuts} />
      {blocked && !approved && (
        <p id="approve-hint" className="text-[13px] text-ink-2">
          Resolve {plural(errors.length, "error", "errors")} to approve this invoice.
        </p>
      )}
      <p className="text-[13px] text-ink-2" suppressHydrationWarning>
        {filePosition && <span className="mr-2 font-medium text-ink">{filePosition}.</span>}
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

      {approve.error && <ProblemAlert error={approve.error} />}
      <p role="status" className="min-h-0 text-[13px] text-ok empty:hidden">
        {saved}
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
        <div className="flex flex-col gap-3">
          <FileIssuesLine invoiceId={id} documentId={invoice.document_id} />
          <IssuesBanner issues={invoice.issues} onGoToField={goToField} />
        </div>
        {invoice.issues.length === 0 && (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-2 lg:hidden">
            No validation issues.
          </p>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section
          title="Source"
          // Desktop: the source stays in view while the fields scroll, and scrolls inside itself.
          className={cn(
            "lg:sticky lg:top-0 lg:flex lg:max-h-[calc(100dvh-5.5rem)] lg:flex-col",
            tab !== "source" && "max-lg:hidden",
          )}
          bodyClassName="lg:min-h-0 lg:overflow-y-auto"
        >
          <div className="p-4">
            {sourceDoc ? (
              <SourcePanel
                documentId={sourceDoc.id}
                filename={sourceDoc.filename}
                pageNumbers={pages}
                page={sourcePage}
                onPageChange={setSourcePage}
                layout="toggle"
              />
            ) : (
              <Skeleton className="h-[380px] w-full bg-skeleton" role="status" aria-label="Loading source" />
            )}
          </div>
        </Section>

        <div className={cn("flex flex-col gap-4", tab !== "fields" && "max-lg:hidden")}>
          <Section title="Extracted fields">
            <p className="border-b border-line px-4 py-2 text-xs text-ink-2">Select a value to correct it.</p>
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
                      onShowIssue={() => showIssue(def.name)}
                      highlighted={target?.name === def.name}
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
        <LineItems invoice={invoice} issues={invoice.issues} />
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
    </>
  );
}

/** Same blocks as the page: breadcrumb header, issues, split view, line items. */
export function InvoiceDetailSkeleton() {
  return (
    <>
    <PageHeader
      crumbs={[{ label: "Invoices", href: "/invoices" }, { label: "Invoice" }]}
      title={<Skeleton className="h-6 w-56 bg-skeleton" />}
      actions={<Skeleton className="h-9 w-36 bg-skeleton" />}
    />
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4" aria-busy="true">
      <Skeleton className="h-4 w-80 bg-skeleton" />
      <Skeleton className="h-24 w-full rounded-lg bg-skeleton" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[520px] w-full rounded-lg bg-skeleton" />
        <Skeleton className="h-[520px] w-full rounded-lg bg-skeleton" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg bg-skeleton" />
    </div>
    </>
  );
}
