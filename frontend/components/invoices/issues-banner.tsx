"use client";

import Link from "next/link";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FIELD_LABELS, ruleTitle, type Issue } from "@/lib/invoices";
import { cn } from "@/lib/utils";

/**
 * Validation issues in plain language. Each states what is wrong with the numbers (the API's
 * message), and links to the field it concerns or to the related invoice.
 */
export function IssuesBanner({
  issues,
  onGoToField,
}: {
  issues: Issue[];
  onGoToField: (field: string) => void;
}) {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const heading =
    errors > 0
      ? `${errors} ${errors === 1 ? "error needs" : "errors need"} a decision before approval${
          warnings > 0 ? `, and ${warnings} ${warnings === 1 ? "warning" : "warnings"} to check` : ""
        }`
      : `${warnings} ${warnings === 1 ? "warning" : "warnings"} to check. You can still approve.`;

  return (
    <section
      aria-label="Validation issues"
      className={cn(
        "rounded-lg border px-4 py-3",
        errors > 0 ? "border-danger/40 bg-danger-bg" : "border-warn-dot/50 bg-warn-bg",
      )}
    >
      <h2 className={cn("flex items-center gap-2 text-sm font-semibold", errors > 0 ? "text-danger" : "text-warn")}>
        {errors > 0 ? (
          <CircleAlert className="size-4 flex-none" aria-hidden="true" />
        ) : (
          <TriangleAlert className="size-4 flex-none" aria-hidden="true" />
        )}
        {heading}
      </h2>
      <ul className="mt-2 flex flex-col divide-y divide-line/70">
        {issues.map((issue, i) => (
          <li key={`${issue.rule_id}-${issue.field ?? ""}-${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink">
                <span className="font-semibold">{ruleTitle(issue.rule_id)}</span>{" "}
                <span className="text-ink-3">
                  {issue.rule_id} · {issue.severity === "error" ? "Error" : "Warning"}
                </span>
              </p>
              <p className="text-[13px] text-ink">{issue.message}</p>
              {issue.expected && issue.actual && (
                <p className="text-xs text-ink-2">
                  Expected {issue.expected}; found {issue.actual}.
                </p>
              )}
            </div>
            <div className="flex flex-none items-center gap-1">
              {issue.field && (
                <Button variant="outline" size="sm" onClick={() => onGoToField(issue.field as string)}>
                  Go to {FIELD_LABELS[issue.field]?.toLowerCase() ?? issue.field}
                </Button>
              )}
              {issue.related_invoice_id && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/invoices/${issue.related_invoice_id}`}>Open related invoice</Link>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
