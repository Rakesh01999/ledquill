"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ProblemMessage } from "@/lib/api/problem";
import { ConfirmDialog } from "./confirm-dialog";
import { useArchiveActions, type ArchiveKind } from "./use-archive";

type Request =
  | { action: "archive"; kind: ArchiveKind; id: string; label: string }
  | { action: "reprocess"; id: string; label: string };

/**
 * `useArchiveActions` plus the confirmation step: Archive and Reprocess ask first (one shared
 * dialog, render `dialog` once per screen); Restore stays direct, it is the undo. After success the
 * Undo toast of Archive still follows. A failure stays in the dialog, with the API's own reason.
 */
export function useConfirmedActions() {
  const actions = useArchiveActions();
  // The request stays after the dialog closes, so its text does not vanish during the fade-out.
  const [request, setRequest] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ProblemMessage | null>(null);
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

  const pending = request
    ? request.action === "archive"
      ? actions.isBusy(request.kind, request.id)
      : actions.isBusy("reprocess", request.id)
    : false;

  async function confirm() {
    if (!request) return;
    setError(null);
    const ok =
      request.action === "archive"
        ? await actions.archive(request.kind, request.id, request.label, { onError: setError })
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
      confirmLabel={request?.action === "reprocess" ? "Reprocess" : "Archive"}
      pendingLabel={request?.action === "reprocess" ? "Reprocessing" : "Archiving"}
      pending={pending}
      error={error}
      returnFocusTo={opener}
      onConfirm={() => void confirm()}
    >
      {body}
    </ConfirmDialog>
  );

  return { ...actions, askArchive, askReprocess, dialog };
}
