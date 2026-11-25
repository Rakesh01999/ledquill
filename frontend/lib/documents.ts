import type { DocumentOut, DocumentStatus, FileType } from "@/lib/api/types";
import { parseSize, DEFAULT_PAGE_SIZE } from "@/lib/paging";
import type { DocumentListParams } from "@/lib/query/options";

export const STATUSES: DocumentStatus[] = ["processing", "queued", "completed", "failed"];
export const FILE_TYPES: { value: FileType; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Image" },
  { value: "xlsx", label: "XLSX" },
  { value: "xls", label: "XLS" },
  { value: "csv", label: "CSV" },
];

export const isActive = (d: Pick<DocumentOut, "status">) => d.status === "queued" || d.status === "processing";

/** Read the list filters from URL search params, ignoring anything unexpected. */
export function parseListParams(sp: URLSearchParams | Record<string, string | string[] | undefined>): DocumentListParams {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return Array.isArray(v) ? v[0] : (v ?? undefined);
  };
  const status = STATUSES.find((s) => s === get("status"));
  const file_type = FILE_TYPES.find((t) => t.value === get("file_type"))?.value;
  const page = Number.parseInt(get("page") ?? "1", 10);
  return { status, file_type, page: Number.isFinite(page) && page >= 1 ? page : 1, size: parseSize(get("size")) };
}

export function listHref(params: DocumentListParams): string {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.file_type) q.set("file_type", params.file_type);
  if (params.size !== DEFAULT_PAGE_SIZE) q.set("size", String(params.size));
  if (params.page > 1) q.set("page", String(params.page));
  const s = q.toString();
  return s ? `/documents?${s}` : "/documents";
}

const STAGE_LABELS: Record<string, string> = {
  detect: "Reading file",
  extract: "Extracting text",
  split: "Finding invoices",
  fields: "Reading fields",
  validate: "Checking numbers",
  index: "Indexing for search",
};

export const stageLabel = (stage: string): string => STAGE_LABELS[stage] ?? stage;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a finished document produced, from counts the list response already carries. */
function outcomeText(doc: DocumentOut): string {
  if (doc.invoice_count === 0) return "No invoices found";
  const issues = doc.issue_count > 0 ? count(doc.issue_count, "issue", "issues") : "no issues";
  return `${count(doc.invoice_count, "invoice", "invoices")}, ${issues}`;
}

/** Stage text for a table row: the stage name while running, otherwise the outcome. */
export function stageText(doc: DocumentOut): string {
  switch (doc.status) {
    case "queued":
      return "Waiting to start";
    case "processing":
      return doc.current_stage ? stageLabel(doc.current_stage) : "Starting";
    case "completed":
      return outcomeText(doc);
    default:
      return doc.error ?? "Failed";
  }
}

const TYPE_TILE: Record<string, string> = { pdf: "PDF", image: "IMG", xlsx: "XLSX", xls: "XLS", csv: "CSV" };
export const typeTile = (fileType: string): string => TYPE_TILE[fileType] ?? fileType.toUpperCase().slice(0, 4);

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 minutes ago" for recent times, a date after a day. */
export function formatWhen(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const seconds = Math.round((t - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Compact age for queues: "12 min", "5 h", "3 d". */
export function formatAge(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const minutes = Math.max(0, Math.round((now - t) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}
