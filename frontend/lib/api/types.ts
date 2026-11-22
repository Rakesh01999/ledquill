import type { components } from "./schema";

/** Aliases of the generated OpenAPI types. Nothing here is hand-written; if the API changes,
 * regenerate `schema.d.ts` and these follow. */
type Schemas = components["schemas"];

export type DocumentOut = Schemas["DocumentOut"];
export type DocumentList = Schemas["DocumentList"];
export type EventOut = Schemas["EventOut"];
export type PageOut = Schemas["PageOut"];
export type InvoiceOut = Schemas["InvoiceOut"];
export type InvoiceList = Schemas["InvoiceList"];
export type UploadResponse = Schemas["UploadResponse"];
export type RejectedFile = Schemas["RejectedFile"];

export type DocumentStatus = "queued" | "processing" | "completed" | "failed";
export type FileType = "pdf" | "image" | "xlsx" | "xls" | "csv";
