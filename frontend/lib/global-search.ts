import type { components } from "@/lib/api/schema";
import { DEFAULT_PAGE_SIZE } from "@/lib/paging";
import { invoicesHref } from "@/lib/invoices";
import { formatDate, formatDecimal } from "@/lib/format";

export type GlobalSearchData = components["schemas"]["GlobalSearch"];

/** Fewer characters than this are not searched: one letter matches half the database. */
export const MIN_QUERY = 2;
export const MAX_QUERY = 200;

export type GroupKey = "invoices" | "documents" | "suppliers" | "archived";

export type ResultRow = {
  key: string;
  group: GroupKey;
  /** Drives the icon. */
  kind: "invoice" | "document" | "supplier";
  title: string;
  /** Text the palette highlights the query in. */
  detail: string;
  href: string;
  archived: boolean;
  /** Status to show as a chip (live items only). */
  status?: string;
};

export type ResultGroup = { key: GroupKey; label: string; rows: ResultRow[]; more: boolean };

const money = (total: string | null, currency: string | null): string | null => {
  const text = formatDecimal(total);
  return text ? (currency ? `${currency} ${text}` : text) : null;
};

/** Secondary line: whatever is known, joined, never an empty "null". */
const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

/** The "see all" target: the Invoices list with this text as its search (Part 2 URL filters). */
export const seeAllHref = (q: string): string => invoicesHref({ q, page: 1, size: DEFAULT_PAGE_SIZE });

/** The groups the palette shows, in order, without the empty ones. */
export function buildGroups(data: GlobalSearchData): ResultGroup[] {
  const groups: ResultGroup[] = [
    {
      key: "invoices",
      label: "Invoices",
      more: data.invoices.more,
      rows: data.invoices.items.map((i) => ({
        key: `invoice:${i.id}`,
        group: "invoices",
        kind: "invoice",
        title: i.invoice_number ?? "No invoice number",
        detail: join(i.supplier_name ?? "Supplier not found", money(i.total, i.currency), formatDate(i.invoice_date)),
        href: `/invoices/${i.id}`,
        archived: false,
        status: i.status,
      })),
    },
    {
      key: "documents",
      label: "Documents",
      more: data.documents.more,
      rows: data.documents.items.map((d) => ({
        key: `document:${d.id}`,
        group: "documents",
        kind: "document",
        title: d.filename,
        detail: d.file_type.toUpperCase(),
        href: `/documents/${d.id}`,
        archived: false,
        status: d.status,
      })),
    },
    {
      key: "suppliers",
      label: "Suppliers",
      more: data.suppliers.more,
      rows: data.suppliers.items.map((s) => ({
        key: `supplier:${s.supplier}`,
        group: "suppliers",
        kind: "supplier",
        title: s.supplier,
        detail: `${s.count} ${s.count === 1 ? "invoice" : "invoices"}`,
        // The exact name, in the Part 2 filter URL: the list shows this supplier's invoices only.
        href: invoicesHref({ supplier: [s.supplier], page: 1, size: DEFAULT_PAGE_SIZE }),
        archived: false,
      })),
    },
    {
      key: "archived",
      label: "Archived",
      more: data.archived.more,
      rows: data.archived.items.map((a) => ({
        key: `archived:${a.kind}:${a.id}`,
        group: "archived",
        kind: a.kind,
        title: a.title,
        detail: join(a.kind === "invoice" ? "Invoice" : "Document", a.detail),
        href: a.kind === "invoice" ? `/invoices/${a.id}` : `/documents/${a.document_id}`,
        archived: true,
      })),
    },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

export type Part = { text: string; hit: boolean };

/**
 * Split `text` into plain and matching parts for the query (whole query and each word, any case).
 * It works on plain strings with indexOf, never builds a regular expression from the query, and
 * the parts are rendered as React text, so nothing the user types can become markup or a pattern.
 */
export function highlightParts(text: string, query: string): Part[] {
  const needles = [...new Set([query.trim(), ...query.split(/\s+/)].map((n) => n.toLowerCase()).filter(Boolean))];
  const lower = text.toLowerCase();
  // Some characters change length when lowercased; highlighting then would point at the wrong text.
  if (needles.length === 0 || lower.length !== text.length) return [{ text, hit: false }];
  const marked = new Array<boolean>(text.length).fill(false);
  for (const needle of needles) {
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      for (let i = at; i < at + needle.length; i++) marked[i] = true;
    }
  }
  const parts: Part[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = marked[i] ?? false;
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else parts.push({ text: text[i] ?? "", hit });
  }
  return parts;
}
