"use client";

import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Loader, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { ApiProblem, describeError } from "@/lib/api/problem";
import type { RejectedFile, UploadResponse } from "@/lib/api/types";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.tif,.tiff,.xlsx,.xls,.csv";
const FILES_PER_REQUEST = 20;
// Public number, never a secret. Set only where the host caps the request body (hosted demo).
const HOSTED_MAX_MB = (() => {
  const n = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB);
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const HOSTED_LIMIT_BYTES = HOSTED_MAX_MB === null ? null : HOSTED_MAX_MB * 1024 * 1024;

/** The file input lives in the dropzone; other parts of the page can open its picker. */
const UPLOAD_INPUT_ID = "upload-files-input";
export function openUploadPicker(): void {
  document.getElementById(UPLOAD_INPUT_ID)?.click();
}

/** Header action: opens the same file picker as the dropzone. */
export function UploadButton() {
  return (
    <Button onClick={openUploadPicker}>
      <Upload aria-hidden="true" /> Upload files
    </Button>
  );
}

/**
 * Groups files into requests: at most FILES_PER_REQUEST each and, where the host caps the request
 * body, no more bytes than the cap. Every file is already within the cap on its own.
 */
function toBatches<T extends { file: File }>(items: T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const full =
      current.length >= FILES_PER_REQUEST ||
      (HOSTED_LIMIT_BYTES !== null && current.length > 0 && bytes + item.file.size > HOSTED_LIMIT_BYTES);
    if (full) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

type Entry =
  | { id: number; name: string; state: "uploading" }
  | { id: number; name: string; state: "accepted" }
  | { id: number; name: string; state: "rejected"; reason: string }
  | { id: number; name: string; state: "failed"; reason: string };

let nextId = 1;

/** One multipart request: every file goes in the `files` field. */
async function postFiles(files: File[]): Promise<UploadResponse> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  const { data, error, response } = await api.POST("/api/v1/documents", {
    // The generated type models binary parts as strings; the real body is the FormData above.
    body: { files: [] },
    bodySerializer: () => form,
  });
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    throw new ApiProblem(response.status, error, retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null);
  }
  return data as UploadResponse;
}

/** When every file in a request is refused, the API answers with an error that lists them. */
function rejectedFromProblem(error: unknown): RejectedFile[] | null {
  if (error instanceof ApiProblem && Array.isArray(error.extra.rejected)) {
    return error.extra.rejected as RejectedFile[];
  }
  return null;
}

export function UploadSection() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef(new Map<number, File>());
  const [dragging, setDragging] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [queued, setQueued] = useState(0);

  const patch = (ids: number[], make: (e: Entry) => Entry | null) =>
    setEntries((list) => list.flatMap((e) => (ids.includes(e.id) ? (make(e) ?? []) : [e])));

  async function send(items: { id: number; file: File }[]) {
    const ids = items.map((i) => i.id);
    patch(ids, (e) => ({ id: e.id, name: e.name, state: "uploading" }));
    let accepted = 0;
    let acceptedIds: number[] = [];
    try {
      let result: { accepted: number; rejected: RejectedFile[] };
      try {
        const body = await postFiles(items.map((i) => i.file));
        result = { accepted: body.accepted.length, rejected: body.rejected };
      } catch (error) {
        const rejected = rejectedFromProblem(error);
        if (!rejected) throw error;
        result = { accepted: 0, rejected };
      }
      accepted = result.accepted;
      // Match refusals to files by name, outside the state updater so it stays pure.
      const refused = [...result.rejected];
      const reasons = new Map<number, string>();
      for (const item of items) {
        const at = refused.findIndex((r) => r.filename === item.file.name);
        const hit = at >= 0 ? refused.splice(at, 1)[0] : undefined;
        if (hit) reasons.set(item.id, hit.reason);
        pending.current.delete(item.id);
      }
      // Files that are not refused were accepted. They stay listed as "Accepted" until the table
      // has reloaded and shows their rows, so a file never disappears before it appears there.
      acceptedIds = ids.filter((i) => !reasons.has(i));
      patch(ids, (e) => {
        const reason = reasons.get(e.id);
        return reason === undefined
          ? { id: e.id, name: e.name, state: "accepted" }
          : { id: e.id, name: e.name, state: "rejected", reason };
      });
    } catch (error) {
      const { title, message } = describeError(error);
      patch(ids, (e) => ({ id: e.id, name: e.name, state: "failed", reason: `${title}. ${message}` }));
    }
    if (accepted > 0) setQueued((n) => n + accepted);
    await queryClient.invalidateQueries({ queryKey: ["documents", "list"] });
    patch(acceptedIds, () => null);
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
  }

  function add(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setQueued(0);
    const items = files.map((file) => ({ id: nextId++, file }));
    // Where the host caps the request body, a file over the cap is refused here, before it is sent.
    const tooLarge = (f: File) => HOSTED_LIMIT_BYTES !== null && f.size > HOSTED_LIMIT_BYTES;
    const toSend = items.filter((i) => !tooLarge(i.file));
    for (const i of toSend) pending.current.set(i.id, i.file);
    setEntries((list) => [
      ...list,
      ...items.map((i): Entry =>
        tooLarge(i.file)
          ? {
              id: i.id,
              name: i.file.name,
              state: "rejected",
              reason: `File too large (${formatBytes(i.file.size)}). The hosted demo accepts files up to ${HOSTED_MAX_MB} MB.`,
            }
          : { id: i.id, name: i.file.name, state: "uploading" },
      ),
    ]);
    // Requests run one after the other so the API's per-minute upload limit counts one request each.
    void (async () => {
      for (const batch of toBatches(toSend)) await send(batch);
    })();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  }

  const retry = (entry: Entry) => {
    const file = pending.current.get(entry.id);
    if (file) void send([{ id: entry.id, file }]);
  };

  return (
    <section aria-label="Upload documents" className="flex flex-col gap-3">
      {/* The whole zone opens the picker on click; the button inside is the keyboard target. */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "flex min-h-11 w-full cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-center transition-colors duration-150 motion-reduce:transition-none sm:flex-row sm:text-left",
          // Drag-over changes colour and adds a ring (no size change), so the zone never jumps.
          dragging
            ? "border-primary bg-primary-soft ring-2 ring-primary/30"
            : "border-line-control bg-surface hover:bg-surface-2/60",
        )}
      >
        <div
          className={cn(
            "flex size-10 flex-none items-center justify-center rounded-lg border bg-surface-2 transition-colors duration-150",
            dragging ? "border-primary text-primary" : "border-line text-ink-2",
          )}
        >
          <Upload className="size-5" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="text-body font-semibold">{dragging ? "Release to upload" : "Drag invoices here and release"}</div>
          <div className="text-ink-2">or choose them from your computer</div>
          <div className="text-caption text-ink-3">
            PDF, JPG, PNG, TIFF, XLSX, XLS, CSV ·{" "}
            {HOSTED_MAX_MB !== null ? `Up to ${HOSTED_MAX_MB} MB per file on the hosted demo` : "Up to 25 MB per file"} ·
            20 files per request. Scans below 150 dpi may not be readable.
          </div>
        </div>
        <Button type="button" variant="outline" className="h-11 w-full flex-none sm:h-8 sm:w-auto">
          Browse files
        </Button>
        <input
          ref={inputRef}
          id={UPLOAD_INPUT_ID}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to upload"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div aria-live="polite" className="text-table text-ink-2 empty:hidden">
        {queued > 0 && !entries.some((e) => e.state === "uploading")
          ? `${queued} ${queued === 1 ? "file" : "files"} accepted and queued. ${queued === 1 ? "It appears" : "They appear"} in the list below.`
          : null}
      </div>

      {entries.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
              {e.state === "uploading" ? (
                <Loader className="mt-0.5 size-4 flex-none text-ink-3 motion-safe:animate-spin" aria-hidden="true" />
              ) : e.state === "accepted" ? (
                <CircleCheck className="mt-0.5 size-4 flex-none text-ok" aria-hidden="true" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 flex-none text-danger" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{e.name}</div>
                <div className={cn("text-table", e.state === "uploading" || e.state === "accepted" ? "text-ink-2" : "text-danger")}>
                  {e.state === "uploading" && "Uploading"}
                  {e.state === "accepted" && "Accepted. It is queued for processing."}
                  {e.state === "rejected" && `Rejected: ${e.reason}`}
                  {e.state === "failed" && `Not uploaded. ${e.reason}`}
                </div>
              </div>
              {e.state === "failed" && (
                <Button variant="outline" size="sm" onClick={() => retry(e)}>
                  Try again
                </Button>
              )}
              {e.state !== "uploading" && e.state !== "accepted" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Dismiss ${e.name}`}
                  onClick={() => patch([e.id], () => null)}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
