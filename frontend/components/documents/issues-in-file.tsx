"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Missing } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import type { InvoiceOut } from "@/lib/api/types";
import { FIELD_LABELS, ruleTitle, type Issue } from "@/lib/invoices";
import { documentInvoicesOptions } from "@/lib/query/options";
import { HEAD } from "@/lib/table";
import { cn } from "@/lib/utils";
import { fromDocument } from "./invoices-found";

type Filter = "all" | "error" | "warning";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "error", label: "Errors" },
  { key: "warning", label: "Warnings" },
];

/** Same columns for every row of every group, so the text lines up down the whole list. */
const ROW_GRID = "lg:grid lg:grid-cols-[minmax(0,15rem)_9rem_minmax(0,1fr)] lg:gap-x-4";

function SeverityIcon({ severity }: { severity: string }) {
  return severity === "error" ? (
    <CircleAlert className="size-4 flex-none text-danger" aria-label="Error" />
  ) : (
    <TriangleAlert className="size-4 flex-none text-warn" aria-label="Warning" />
  );
}

/** The invoice page, scrolled to the field when the issue names one the page can show. */
function issueHref(invoice: InvoiceOut, issue: Issue): string {
  const field = issue.field && issue.field in FIELD_LABELS ? issue.field : null;
  return fromDocument(invoice.id, field ? `#field-${field}` : "#issues");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Every validation issue of the file, grouped by invoice (errors first within a group), with an
 * All / Errors / Warnings filter. Each row links to its invoice, at the field it is about.
 */
export function IssuesInFile({ documentId, archived = false }: { documentId: string; archived?: boolean }) {
  const { data } = useQuery(documentInvoicesOptions(api, documentId, archived));
  const [filter, setFilter] = useState<Filter>("all");
  if (!data) return null;

  const groups = data.items
    .map((invoice) => ({
      invoice,
      issues: [...invoice.issues].sort(
        (a, b) => Number(b.severity === "error") - Number(a.severity === "error"),
      ),
    }))
    .filter((g) => g.issues.length > 0);
  if (groups.length === 0) return null;

  const all = groups.flatMap((g) => g.issues);
  const counts: Record<Filter, number> = {
    all: all.length,
    error: all.filter((i) => i.severity === "error").length,
    warning: all.filter((i) => i.severity !== "error").length,
  };
  const matches = (issue: Issue) =>
    filter === "all" || (filter === "error" ? issue.severity === "error" : issue.severity !== "error");
  const shown = groups
    .map((g) => ({ ...g, issues: g.issues.filter(matches) }))
    .filter((g) => g.issues.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2">
        <div
          role="group"
          aria-label="Filter issues by severity"
          className="flex flex-none overflow-hidden rounded-md border border-line text-xs"
        >
          {FILTERS.map(({ key, label }, i) => (
            <button
              key={key}
              type="button"
              data-focus-inset
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                "px-2.5 py-1 outline-none hover:bg-surface-2",
                i > 0 && "border-l border-line",
                filter === key ? "bg-primary-soft font-semibold text-link" : "text-ink-2",
              )}
            >
              {label} <span className="tabular-nums">{counts[key]}</span>
            </button>
          ))}
        </div>
        <p role="status" className="text-xs text-ink-2">
          {plural(shown.reduce((n, g) => n + g.issues.length, 0), "issue", "issues")} in{" "}
          {plural(shown.length, "invoice", "invoices")}
        </p>
      </div>

      {/* Column header of the rows below (lg and up): sticks under the page header like a table's. */}
      <div className={cn(HEAD, "hidden px-4 py-2", ROW_GRID)} aria-hidden="true">
        <span>Rule</span>
        <span>Field</span>
        <span>Message</span>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={filter === "error" ? "No errors in this file." : "No warnings in this file."} />
      ) : (
        <div className="divide-y divide-line">
          {shown.map(({ invoice, issues }) => {
            const errors = issues.filter((i) => i.severity === "error").length;
            return (
              <section key={invoice.id} aria-label={`Issues of ${invoice.invoice_number ?? "invoice without a number"}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-surface-2 px-4 py-1.5">
                  <Link
                    href={fromDocument(invoice.id, "#issues")}
                    className="font-mono text-[13px] font-medium text-link hover:underline"
                  >
                    {invoice.invoice_number ?? <Missing />}
                    {!invoice.invoice_number && <span className="sr-only">Invoice without a number</span>}
                  </Link>
                  {invoice.supplier_name && <span className="text-xs text-ink-2">{invoice.supplier_name}</span>}
                  <span className="text-xs text-ink-3">
                    {errors > 0 && plural(errors, "error", "errors")}
                    {errors > 0 && issues.length > errors && ", "}
                    {issues.length > errors && plural(issues.length - errors, "warning", "warnings")}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {issues.map((issue, n) => (
                    <li
                      key={`${issue.rule_id}-${issue.field ?? ""}-${n}`}
                      className={cn("flex flex-col gap-1 px-4 py-2.5 text-[13px]", ROW_GRID)}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <SeverityIcon severity={issue.severity} />
                        <span className="font-mono text-xs text-ink-2">{issue.rule_id}</span>
                        <span className="truncate font-medium">{ruleTitle(issue.rule_id)}</span>
                      </span>
                      <Link href={issueHref(invoice, issue)} className="w-fit text-link hover:underline">
                        {issue.field ? (FIELD_LABELS[issue.field] ?? issue.field) : "Whole invoice"}
                        <span className="sr-only">
                          . Open {invoice.invoice_number ?? "the invoice"} at this field
                        </span>
                      </Link>
                      <span className="min-w-0 text-ink">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
