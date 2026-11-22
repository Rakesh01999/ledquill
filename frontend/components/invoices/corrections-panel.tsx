import { Missing } from "@/components/shared/money";
import { formatDate, formatDecimal } from "@/lib/format";
import { FIELD_GROUPS, FIELD_LABELS } from "@/lib/invoices";
import { formatWhen } from "@/lib/documents";
import type { InvoiceOut } from "@/lib/api/types";

const MONEY_FIELDS = new Set(FIELD_GROUPS.flatMap((g) => g.fields.filter((f) => f.kind === "money").map((f) => f.name)));

function show(field: string, value: string | null) {
  if (value === null || value === "") return <Missing />;
  if (MONEY_FIELDS.has(field as never)) return formatDecimal(value) ?? value;
  if (field === "invoice_date") return formatDate(value) ?? value;
  return value;
}

/** The audit trail: what a reviewer changed, from what, and when (newest first). */
export function CorrectionsPanel({ corrections }: { corrections: InvoiceOut["corrections"] }) {
  if (corrections.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-ink-2">No corrections yet.</p>;
  }
  const rows = [...corrections].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <ul className="divide-y divide-line">
      {rows.map((c, i) => (
        <li key={`${c.field}-${c.created_at}-${i}`} className="px-4 py-2.5 text-[13px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{FIELD_LABELS[c.field] ?? c.field}</span>
            <span className="text-xs text-ink-3" suppressHydrationWarning>
              {formatWhen(c.created_at)}
            </span>
          </div>
          <p className="text-ink-2">
            <span className="line-through decoration-ink-3">{show(c.field, c.old_value)}</span>
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> changed to </span>
            <span className="font-medium text-ink">{show(c.field, c.new_value)}</span>
          </p>
          {c.note && <p className="text-xs text-ink-3">{c.note}</p>}
        </li>
      ))}
    </ul>
  );
}
