"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { documentInvoicesOptions } from "@/lib/query/options";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Disabled stays readable: the base button fades to half opacity, which made the label hard to read.
const disabledLook = "disabled:bg-surface-2 disabled:text-ink-3 disabled:opacity-100";

/**
 * One line above the issues banner when the invoice's file holds several invoices: how many
 * invoices and issues the whole file has, and a way to the next and previous invoice with issues.
 * Same data as "Invoices found" on the document page (one shared query).
 */
export function FileIssuesLine({ invoiceId, documentId }: { invoiceId: string; documentId: string }) {
  const { data } = useQuery(documentInvoicesOptions(api, documentId));
  if (!data || data.items.length < 2) return null;

  const items = data.items;
  const issueCount = items.reduce((sum, inv) => sum + inv.issues.length, 0);
  if (issueCount === 0) return null;

  const at = items.findIndex((inv) => inv.id === invoiceId);
  const withIssues = (inv: (typeof items)[number]) => inv.issues.length > 0 && inv.id !== invoiceId;
  const prev = items.slice(0, Math.max(at, 0)).filter(withIssues).at(-1);
  const next = items.slice(at + 1).find(withIssues);
  const partial = data.total > items.length;

  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-[13px] text-ink">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1">
          {partial
            ? `This file has ${data.total} invoices; the first ${items.length} have ${plural(issueCount, "issue", "issues")} in total`
            : `This file has ${plural(items.length, "invoice", "invoices")}, ${plural(issueCount, "issue", "issues")} in total`}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {prev ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/invoices/${prev.id}#issues`}>
                <ChevronLeft aria-hidden="true" />
                Previous invoice with issues
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled className={disabledLook}>
              <ChevronLeft aria-hidden="true" />
              Previous invoice with issues
            </Button>
          )}
          {next ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/invoices/${next.id}#issues`}>
                Next invoice with issues
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled className={disabledLook}>
              Next invoice with issues
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {at >= 0 && (
        <p className="text-xs text-ink-2">
          Showing invoice {at + 1} of {items.length}. These buttons skip invoices that have no issues.
        </p>
      )}
    </div>
  );
}
