"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Missing } from "@/components/shared/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { FIELD_LABELS, ruleTitle } from "@/lib/invoices";
import { documentInvoicesOptions } from "@/lib/query/options";

const head = "text-xs font-medium text-ink-2";

/** Every validation issue of every invoice in the file, errors first, each linking to its invoice. */
export function IssuesInFile({ documentId }: { documentId: string }) {
  const { data } = useQuery(documentInvoicesOptions(api, documentId));
  if (!data) return null;

  const rows = data.items
    .flatMap((invoice, order) =>
      invoice.issues.map((issue, n) => ({
        invoice,
        issue,
        key: `${order}-${n}`,
      })),
    )
    .sort(
      (a, b) =>
        Number(b.issue.severity === "error") -
        Number(a.issue.severity === "error"),
    );
  if (rows.length === 0) return null;

  return (
    <>
      <Table className="hidden min-w-[720px] lg:table">
        <TableHeader className="bg-surface-2 [&_tr]:border-line">
          <TableRow className="h-9 hover:bg-transparent">
            <TableHead className={`pl-4 ${head}`}>Invoice</TableHead>
            <TableHead className={head}>Rule</TableHead>
            <TableHead className={head}>Field</TableHead>
            <TableHead className={`pr-4 ${head}`}>Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ invoice, issue, key }) => (
            <TableRow
              key={key}
              className="border-line align-top hover:bg-surface-2/60"
            >
              <TableCell className="pl-4 whitespace-nowrap">
                <Link
                  href={`/invoices/${invoice.id}#issues`}
                  className="font-mono text-[13px] font-medium text-link hover:underline"
                >
                  {invoice.invoice_number ?? <Missing />}
                  {!invoice.invoice_number && (
                    <span className="sr-only">Invoice without a number</span>
                  )}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="flex items-center gap-1.5">
                  {issue.severity === "error" ? (
                    <CircleAlert
                      className="size-4 flex-none text-danger"
                      aria-label="Error"
                    />
                  ) : (
                    <TriangleAlert
                      className="size-4 flex-none text-warn"
                      aria-label="Warning"
                    />
                  )}
                  <span className="font-mono text-xs text-ink-2">
                    {issue.rule_id}
                  </span>
                  <span className="font-medium">
                    {ruleTitle(issue.rule_id)}
                  </span>
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-ink-2">
                {issue.field
                  ? (FIELD_LABELS[issue.field] ?? issue.field)
                  : "Whole invoice"}
              </TableCell>
              <TableCell className="pr-4 whitespace-normal text-ink">
                {issue.message}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className="divide-y divide-line lg:hidden">
        {rows.map(({ invoice, issue, key }) => (
          <li key={key} className="flex flex-col gap-1 px-4 py-3 text-[13px]">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {issue.severity === "error" ? (
                <CircleAlert
                  className="size-4 flex-none text-danger"
                  aria-label="Error"
                />
              ) : (
                <TriangleAlert
                  className="size-4 flex-none text-warn"
                  aria-label="Warning"
                />
              )}
              <Link
                href={`/invoices/${invoice.id}#issues`}
                className="font-mono font-medium text-link hover:underline"
              >
                {invoice.invoice_number ?? "Invoice without a number"}
              </Link>
              <span className="font-mono text-xs text-ink-2">
                {issue.rule_id}
              </span>
              <span className="font-medium">{ruleTitle(issue.rule_id)}</span>
            </span>
            <span className="text-ink">{issue.message}</span>
            {issue.field && (
              <span className="text-xs text-ink-2">
                Field: {FIELD_LABELS[issue.field] ?? issue.field}
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
