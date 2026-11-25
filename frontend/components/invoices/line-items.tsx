import { CircleAlert, TriangleAlert } from "lucide-react";
import { Missing, Money } from "@/components/shared/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isZeroDecimal, subtractDecimals, sumDecimals } from "@/lib/decimal";
import { formatDecimal, formatQuantity } from "@/lib/format";
import type { InvoiceOut } from "@/lib/api/types";
import { issueLineNo, type Issue } from "@/lib/invoices";
import { cn } from "@/lib/utils";

const head = "text-xs font-medium text-ink-2";

/** Line items, with their computed sum set against the printed subtotal (string arithmetic). */
export function LineItems({ invoice, issues = [] }: { invoice: InvoiceOut; issues?: Issue[] }) {
  const items = invoice.line_items;
  if (items.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-ink-2">No line items were found.</p>;
  }
  const computed = sumDecimals(items.map((i) => i.amount));
  const printed = invoice.subtotal;
  const diff = computed !== null && printed !== null ? subtractDecimals(printed, computed) : null;
  const matches = diff !== null && isZeroDecimal(diff);
  const cur = invoice.currency ? ` (${invoice.currency})` : "";

  return (
    <Table className="min-w-[560px]">
      <TableHeader className="bg-surface-2 [&_tr]:border-line">
        <TableRow className="h-9 hover:bg-transparent">
          <TableHead className={cn("w-10 pl-4", head)}>#</TableHead>
          <TableHead className={head}>Description</TableHead>
          <TableHead className={cn("text-right", head)}>Qty</TableHead>
          <TableHead className={cn("text-right", head)}>Unit price{cur}</TableHead>
          <TableHead className={cn("pr-4 text-right", head)}>Amount{cur}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((li) => {
          const lineIssues = issues.filter((i) => issueLineNo(i) === li.line_no);
          const hasError = lineIssues.some((i) => i.severity === "error");
          return (
          <TableRow
            key={li.line_no}
            className={cn(
              "h-10 border-line hover:bg-transparent",
              lineIssues.length > 0 && (hasError ? "bg-danger-bg/50" : "bg-warn-bg/50"),
            )}
          >
            <TableCell className="pl-4 align-top text-ink-3 tabular-nums">{li.line_no}</TableCell>
            <TableCell className="max-w-72 whitespace-normal">
              {li.description ?? <Missing />}
              {lineIssues.map((i, n) => (
                <span key={n} className={cn("mt-0.5 flex items-start gap-1 text-xs", i.severity === "error" ? "text-danger" : "text-warn")}>
                  {i.severity === "error" ? (
                    <CircleAlert className="mt-px size-3.5 flex-none" aria-hidden="true" />
                  ) : (
                    <TriangleAlert className="mt-px size-3.5 flex-none" aria-hidden="true" />
                  )}
                  <span>
                    {i.severity === "error" ? "Error" : "Warning"}: {i.message}
                  </span>
                </span>
              ))}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatQuantity(li.quantity) ?? <Missing />}</TableCell>
            <TableCell className="text-right">
              <Money value={li.unit_price} />
            </TableCell>
            <TableCell className="pr-4 text-right">
              <Money value={li.amount} />
            </TableCell>
          </TableRow>
          );
        })}
        <TableRow className="h-9 border-line bg-surface-2/60 hover:bg-surface-2/60">
          <TableCell colSpan={4} className="pl-4 text-right text-ink-2">
            Computed sum of amounts
          </TableCell>
          <TableCell className="pr-4 text-right tabular-nums">{formatDecimal(computed) ?? <Missing />}</TableCell>
        </TableRow>
        <TableRow className="h-9 border-line bg-surface-2/60 hover:bg-surface-2/60">
          <TableCell colSpan={4} className="pl-4 text-right text-ink-2">
            Printed subtotal
          </TableCell>
          <TableCell className="pr-4 text-right tabular-nums">{formatDecimal(printed) ?? <Missing />}</TableCell>
        </TableRow>
        {diff !== null && (
          <TableRow className="h-9 border-line bg-surface-2/60 hover:bg-surface-2/60">
            <TableCell colSpan={4} className="pl-4 text-right text-ink-2">
              Comparison
            </TableCell>
            <TableCell className={cn("pr-4 text-right font-medium", matches ? "text-ok" : "text-warn")}>
              {matches ? "Matches" : `Differs by ${formatDecimal(diff.replace("-", ""))}`}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
