"use client";

import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Loader, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { ApiProblem, describeError } from "@/lib/api/problem";
import type { RejectedFile, UploadResponse } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.tif,.tiff,.xlsx,.xls,.csv";
const FILES_PER_REQUEST = 20;
// Public number, never a secret. Set only where the host caps the request body (hosted demo).
const HOSTED_MAX_MB = (() => {
  const n = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

type Entry =
  | { id: number; name: string; state: "uploading" }
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
      // Files that are not refused were accepted: they now show as rows in the table.
      patch(ids, (e) => {
        const reason = reasons.get(e.id);
        return reason === undefined ? null : { id: e.id, name: e.name, state: "rejected", reason };
      });
    } catch (error) {
      const { title, message } = describeError(error);
      patch(ids, (e) => ({ id: e.id, name: e.name, state: "failed", reason: `${title}. ${message}` }));
    }
    if (accepted > 0) setQueued((n) => n + accepted);
    await queryClient.invalidateQueries({ queryKey: ["documents", "list"] });
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
  }

  function add(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setQueued(0);
    const items = files.map((file) => ({ id: nextId++, file }));
    for (const i of items) pending.current.set(i.id, i.file);
    setEntries((list) => [...list, ...items.map((i) => ({ id: i.id, name: i.file.name, state: "uploading" as const }))]);
    // Batches run one after the other so the API's per-minute upload limit counts one request each.
    void (async () => {
      for (let n = 0; n < items.length; n += FILES_PER_REQUEST) {
        await send(items.slice(n, n + FILES_PER_REQUEST));
      }
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
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-dashed bg-surface px-5 py-4 transition-colors sm:flex-row sm:items-center sm:gap-5 sm:px-6 sm:py-5",
          dragging ? "border-primary bg-primary-soft" : "border-line-strong",
        )}
      >
        <div className="flex size-11 flex-none items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-2">
          <Upload className="size-[18px]" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-sm font-semibold">
            Drop invoices here, or{" "}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="cursor-pointer rounded-sm font-semibold text-link underline-offset-2 hover:underline"
            >
              browse files
            </button>
          </div>
          <div className="text-ink-2">
            PDF, JPG, PNG, TIFF, XLSX, XLS, CSV ·{" "}
            {HOSTED_MAX_MB !== null
              ? `up to ${HOSTED_MAX_MB} MB per upload (hosted demo)`
              : "up to 25 MB per file"}{" "}
            · 20 files per upload
          </div>
        </div>
        <div className="text-xs text-ink-3">Scans under 150 dpi may fail OCR</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to upload"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div aria-live="polite" className="text-[13px] text-ink-2 empty:hidden">
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
              ) : (
                <CircleAlert className="mt-0.5 size-4 flex-none text-danger" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{e.name}</div>
                <div className={cn("text-[13px]", e.state === "uploading" ? "text-ink-2" : "text-danger")}>
                  {e.state === "uploading" && "Uploading"}
                  {e.state === "rejected" && `Rejected: ${e.reason}`}
                  {e.state === "failed" && `Not uploaded. ${e.reason}`}
                </div>
              </div>
              {e.state === "failed" && (
                <Button variant="outline" size="sm" onClick={() => retry(e)}>
                  Try again
                </Button>
              )}
              {e.state !== "uploading" && (
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
