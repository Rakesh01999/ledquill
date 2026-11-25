import type { InvoiceOut } from "@/lib/api/types";
import { isMoneyInput, normalizeMoney } from "@/lib/decimal";
import { DEFAULT_PAGE_SIZE, parseSize } from "@/lib/paging";

export type FieldKind = "text" | "date" | "currency" | "money";
export type FieldName =
  | "supplier_name"
  | "customer_name"
  | "invoice_number"
  | "invoice_date"
  | "currency"
  | "subtotal"
  | "tax"
  | "total";

export type FieldDef = { name: FieldName; label: string; kind: FieldKind };

/** Groups as in the mockup: Parties, Invoice, Amounts. */
export const FIELD_GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Parties",
    fields: [
      { name: "supplier_name", label: "Supplier", kind: "text" },
      { name: "customer_name", label: "Customer", kind: "text" },
    ],
  },
  {
    title: "Invoice",
    fields: [
      { name: "invoice_number", label: "Invoice number", kind: "text" },
      { name: "invoice_date", label: "Invoice date", kind: "date" },
      { name: "currency", label: "Currency", kind: "currency" },
    ],
  },
  {
    title: "Amounts",
    fields: [
      { name: "subtotal", label: "Subtotal", kind: "money" },
      { name: "tax", label: "Tax", kind: "money" },
      { name: "total", label: "Total", kind: "money" },
    ],
  },
];

/** How an invoice is named in a message: its number, or a plain description when it has none. */
export const invoiceLabel = (inv: { invoice_number: string | null }): string =>
  inv.invoice_number ? `invoice ${inv.invoice_number}` : "invoice without a number";

export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  FIELD_GROUPS.flatMap((g) => g.fields.map((f) => [f.name, f.label])),
);

/** Plain names for the validation rules (docs/requirements.md section 7). */
export const RULE_TITLES: Record<string, string> = {
  "V-01": "Required field missing",
  "V-02": "Invalid value",
  "V-03": "Line total",
  "V-04": "Subtotal",
  "V-05": "Total",
  "V-06": "Date",
  "V-07": "Possible duplicate",
  "V-08": "Low confidence",
  "V-09": "Differs from another source",
};

export const ruleTitle = (id: string): string => RULE_TITLES[id] ?? id;

export type Issue = InvoiceOut["issues"][number];

/** The file name V-09 quotes in its message ("... but X in "other.pdf""), if there is one. */
export const otherFileName = (message: string): string | null => /\bin "([^"]+)"\s*\.?$/.exec(message)?.[1] ?? null;

/** "line_items[2].amount" -> 2; null for any other field. */
export function issueLineNo(issue: Issue): number | null {
  const m = /^line_items\[(\d+)\]/.exec(issue.field ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * One line telling the reviewer what they can do about an issue, from what each rule checks
 * (backend/app/pipeline/validate.py) and what this screen can do: edit a header field, approve,
 * open the other invoice. Line items are read-only here, so no hint tells anyone to edit them.
 */
export function issueHint(issue: Issue): string {
  const field = issue.field ?? "";
  const label = (FIELD_LABELS[field] ?? field).toLowerCase();
  switch (issue.rule_id) {
    case "V-01":
      return `Find the ${label} on the source page, select it here and enter it. The error clears once it is saved.`;
    case "V-02":
      return issueLineNo(issue) !== null
        ? "A line value is negative. Line items cannot be edited on this screen; compare with the source."
        : field === "currency"
          ? "Select Currency and enter a three-letter code such as USD or EUR. You can still approve."
          : `Check the sign of the ${label} on the source and correct it.`;
    case "V-03":
      return "Compare this line with the source. Line items cannot be edited here; if the document itself is wrong you can still approve.";
    case "V-04":
      return "Compare the line items with the printed subtotal on the source. If the subtotal was misread, edit Subtotal. Line items cannot be edited here.";
    case "V-05":
      return "Compare subtotal, tax and total with the source and edit the one that was misread.";
    case "V-06":
      return "Check the date on the source and edit it if it was misread. If it is correct you can still approve.";
    case "V-07":
      return field === "invoice_number"
        ? "Open the existing copy and compare. If this number was misread, edit Invoice number; otherwise this is a duplicate: archive one of the two documents from its document page."
        : "Open the existing copy. This is the same file uploaded twice. Editing fields cannot clear this; the error goes when one of the two documents is archived from its document page.";
    case "V-08":
      return field
        ? `Check the ${label} against the source page and edit it if it is wrong. Saving an edit marks it as checked.`
        : "This describes how the file was read, so editing does not clear it. Compare every field with the source; you can still approve.";
    case "V-09":
      return `The same invoice number exists in another file with a different ${label || "value"}. Open it and check which value is correct; edit this invoice if its value is wrong.`;
    default:
      return "";
  }
}

export const errorIssues = (inv: Pick<InvoiceOut, "issues">): Issue[] =>
  inv.issues.filter((i) => i.severity === "error");

/** The issue shown in the review queue: the first error, else the first warning. */
export function topIssue(inv: Pick<InvoiceOut, "issues">): Issue | undefined {
  return inv.issues.find((i) => i.severity === "error") ?? inv.issues[0];
}

export type ConfidenceLevel = "high" | "medium" | "low";

/** At least 0.9 shows no marker, 0.7 to 0.9 an amber dot, below 0.7 an amber field. */
export function confidenceLevel(value: number | undefined): ConfidenceLevel | null {
  if (value === undefined) return null;
  if (value >= 0.9) return "high";
  if (value >= 0.7) return "medium";
  return "low";
}

/** The current value of a field as the text the editor starts from. */
export function fieldValue(inv: InvoiceOut, name: FieldName): string | null {
  const v = inv[name];
  return v === undefined || v === null ? null : String(v);
}

export type Parsed = { ok: true; value: string | null } | { ok: false; error: string };

/** Validate an edited value. Empty clears the field (null). Money stays a string. */
export function parseEdit(kind: FieldKind, raw: string): Parsed {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };
  switch (kind) {
    case "money":
      return isMoneyInput(text)
        ? { ok: true, value: text }
        : { ok: false, error: "Enter an amount such as 1150.00, with at most two decimals." };
    case "currency":
      return /^[A-Za-z]{3}$/.test(text)
        ? { ok: true, value: text.toUpperCase() }
        : { ok: false, error: "Enter a 3-letter currency code, for example USD." };
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, error: "Enter a date as YYYY-MM-DD." };
    default:
      return text.length <= 200 ? { ok: true, value: text } : { ok: false, error: "Use at most 200 characters." };
  }
}

/** Did the edit change anything? Money compares as normalised decimal text, never as a float. */
export function isChanged(kind: FieldKind, current: string | null, next: string | null): boolean {
  if (current === next) return false;
  if (kind === "money" && current !== null && next !== null) {
    return normalizeMoney(current) !== normalizeMoney(next);
  }
  return true;
}

export type InvoiceListParams = {
  q?: string;
  status?: "needs_review" | "ready" | "approved";
  supplier?: string;
  currency?: string;
  date_from?: string;
  date_to?: string;
  min_total?: string;
  max_total?: string;
  page: number;
  size: number;
};

const STATUS_VALUES = ["needs_review", "ready", "approved"] as const;

export function parseInvoiceParams(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): InvoiceListParams {
  const get = (k: string): string | undefined => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  const num = (k: string) => {
    const v = get(k);
    return v && isMoneyInput(v) ? v : undefined;
  };
  const date = (k: string) => {
    const v = get(k);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  const cur = get("currency");
  const page = Number.parseInt(get("page") ?? "1", 10);
  return {
    q: get("q")?.slice(0, 200),
    status: STATUS_VALUES.find((s) => s === get("status")),
    supplier: get("supplier")?.slice(0, 200),
    currency: cur && /^[A-Za-z]{3}$/.test(cur) ? cur.toUpperCase() : undefined,
    date_from: date("date_from"),
    date_to: date("date_to"),
    min_total: num("min_total"),
    max_total: num("max_total"),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    size: parseSize(get("size")),
  };
}

export function invoicesHref(params: InvoiceListParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "page" || k === "size") continue;
    if (typeof v === "string" && v) q.set(k, v);
  }
  if (params.size !== DEFAULT_PAGE_SIZE) q.set("size", String(params.size));
  if (params.page > 1) q.set("page", String(params.page));
  const s = q.toString();
  return s ? `/invoices?${s}` : "/invoices";
}

/** Only a query, no other filter: this is the case that uses ranked hybrid search. */
export const isSearchOnly = (p: InvoiceListParams): boolean =>
  Boolean(p.q) && !p.status && !p.supplier && !p.currency && !p.date_from && !p.date_to && !p.min_total && !p.max_total;

export const FALLBACK_NOTES: Record<string, string> = {
  semantic_disabled: "Semantic search is turned off on this server, so these are keyword matches only.",
  embedder_error: "The semantic model did not respond, so these are keyword matches only.",
};
