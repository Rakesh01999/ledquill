"use client";

import { useRef, useState, type ReactNode } from "react";
import { describeError, type ProblemMessage } from "@/lib/api/problem";
import { ConfirmDialog } from "./confirm-dialog";
import { useArchiveActions, type ArchiveKind } from "./use-archive";

type Request =
  | { action: "archive" | "restore"; kind: ArchiveKind; id: string; label: string }
  | { action: "reprocess"; id: string; label: string }
  // Approve runs the caller's own mutation (it needs the page's navigation and cache handling).
  | { action: "approve"; label: string; perform: () => Promise<unknown> };

const COPY = {
  archive: { confirm: "Archive", pending: "Archiving" },
  restore: { confirm: "Restore", pending: "Restoring" },
  reprocess: { confirm: "Reprocess", pending: "Reprocessing" },
  approve: { confirm: "Approve", pending: "Approving" },
} as const;

/**
 * `useArchiveActions` plus the confirmation step: Restore, Archive, Reprocess and Approve all ask
 * first (one shared dialog, render `dialog` once per screen). The Undo toast that follows an
 * Archive is the only direct action. A failure stays in the dialog, with the API's own reason.
 */
export function useConfirmedActions() {
  const actions = useArchiveActions();
  // The request stays after the dialog closes, so its text does not vanish during the fade-out.
  const [request, setRequest] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ProblemMessage | null>(null);
  const [approving, setApproving] = useState(false);
  // The button that opened the dialog: focus goes back to it when the dialog closes.
  const opener = useRef<HTMLElement | null>(null);
  const remember = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const askArchive = (kind: ArchiveKind, id: string, label: string) => {
    remember();
    setError(null);
    setRequest({ action: "archive", kind, id, label });
    setOpen(true);
  };
  const askReprocess = (id: string, label: string) => {
    remember();
    setError(null);
    setRequest({ action: "reprocess", id, label });
    setOpen(true);
  };

  const askRestore = (kind: ArchiveKind, id: string, label: string) => {
    remember();
    setError(null);
    setRequest({ action: "restore", kind, id, label });
    setOpen(true);
  };
  const askApprove = (label: string, perform: () => Promise<unknown>) => {
    remember();
    setError(null);
    setRequest({ action: "approve", label, perform });
    setOpen(true);
  };

  const pending = !request
    ? false
    : request.action === "approve"
      ? approving
      : request.action === "reprocess"
        ? actions.isBusy("reprocess", request.id)
        : actions.isBusy(request.kind, request.id);

  async function confirm() {
    if (!request) return;
    setError(null);
    if (request.action === "approve") {
      setApproving(true);
      try {
        await request.perform();
        setOpen(false);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setApproving(false);
      }
      return;
    }
    const ok =
      request.action === "archive"
        ? await actions.archive(request.kind, request.id, request.label, { onError: setError })
        : request.action === "restore"
          ? await actions.restore(request.kind, request.id, request.label, { onError: setError })
          : await actions.reprocess(request.id, { onError: setError });
    if (ok) setOpen(false);
  }

  let title = "";
  let body: ReactNode = null;
  if (request?.action === "archive") {
    title = `Archive ${request.label}?`;
    body = (
      <>
        <p>Nothing is deleted. You can restore it from Archived.</p>
        {request.kind === "document" && <p>Its invoices are archived with it.</p>}
      </>
    );
  } else if (request?.action === "restore") {
    title = `Restore ${request.label}?`;
    body = (
      <p>
        This {request.kind} returns to the active {request.kind === "document" ? "Documents" : "Invoices"} list.
      </p>
    );
  } else if (request?.action === "approve") {
    title = `Approve ${request.label}?`;
    body = <p>The invoice is marked as approved.</p>;
  } else if (request) {
    title = `Reprocess ${request.label}?`;
    body = (
      <>
        <p>The invoices of this file are rebuilt from its text.</p>
        <p>It is refused if any invoice has corrections or approvals, so that reviewer work is never lost.</p>
      </>
    );
  }

  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={title}
      confirmLabel={COPY[request?.action ?? "archive"].confirm}
      pendingLabel={COPY[request?.action ?? "archive"].pending}
      initialFocus={request?.action === "approve" ? "confirm" : "cancel"}
      pending={pending}
      error={error}
      returnFocusTo={opener}
      onConfirm={() => void confirm()}
    >
      {body}
    </ConfirmDialog>
  );

  return { ...actions, askArchive, askRestore, askReprocess, askApprove, dialog };
}
