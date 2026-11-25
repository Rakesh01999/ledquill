"use client";

import Link from "next/link";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FIELD_LABELS, ruleTitle, type Issue } from "@/lib/invoices";
import { cn } from "@/lib/utils";

/**
 * The expected/found line only when it adds something: the numeric rules already put both values
 * in the message, and "a value / missing" (V-01) says nothing the message does not.
 */
function showsExpectedFound(issue: Issue): boolean {
  if (!issue.expected || !issue.actual || issue.rule_id === "V-01") return false;
  return !(issue.message.includes(issue.expected) && issue.message.includes(issue.actual));
}

/**
 * What the related invoice is, per rule (validate.py): V-07 points at the copy that was stored
 * first (same file, or same number and supplier); V-09 at the same invoice number in another document.
 */
function relatedLabel(ruleId: string): string {
  if (ruleId === "V-07") return "Open the existing copy";
  if (ruleId === "V-09") return "Open the matching invoice";
  return "Open related invoice";
}

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
  // One "Go to <field>" per field and one link per related invoice: only the first issue that has it shows it.
  const seenFields = new Set<string>();
  const seenRelated = new Set<string>();
  const rows = issues.map((issue) => {
    const goTo = issue.field && !seenFields.has(issue.field) ? issue.field : null;
    const related =
      issue.related_invoice_id && !seenRelated.has(issue.related_invoice_id) ? issue.related_invoice_id : null;
    if (goTo) seenFields.add(goTo);
    if (related) seenRelated.add(related);
    return { issue, goTo, related };
  });
  const heading =
    errors > 0
      ? `${errors} ${errors === 1 ? "error needs" : "errors need"} a decision before approval${
          warnings > 0 ? `, and ${warnings} ${warnings === 1 ? "warning" : "warnings"} to check` : ""
        }`
      : `${warnings} ${warnings === 1 ? "warning" : "warnings"} to check. You can still approve.`;

  return (
    <section
      id="issues"
      tabIndex={-1}
      aria-label="Validation issues"
      className={cn(
        "scroll-mt-4 rounded-lg border px-4 py-3 outline-none",
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
        {rows.map(({ issue, goTo, related }, i) => (
          <li key={`${issue.rule_id}-${issue.field ?? ""}-${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink">
                <span className="font-semibold">{ruleTitle(issue.rule_id)}</span>{" "}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="cursor-help rounded-sm text-ink-2 underline decoration-dotted underline-offset-2">
                      {issue.severity === "error" ? "Error" : "Warning"}
                      <span className="sr-only">, rule {issue.rule_id}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Rule {issue.rule_id}</TooltipContent>
                </Tooltip>
              </p>
              <p className="text-[13px] text-ink">{issue.message}</p>
              {showsExpectedFound(issue) && (
                <p className="text-xs text-ink-2">
                  Expected {issue.expected}; found {issue.actual}.
                </p>
              )}
            </div>
            {(goTo || related) && (
              <div className="flex flex-none flex-wrap items-center gap-1">
                {goTo && (
                  <Button variant="outline" size="sm" onClick={() => onGoToField(goTo as string)}>
                    Go to {FIELD_LABELS[goTo as string]?.toLowerCase() ?? goTo}
                  </Button>
                )}
                {related && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/invoices/${related}`}>{relatedLabel(issue.rule_id)}</Link>
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
