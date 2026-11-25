"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ProblemMessage } from "@/lib/api/problem";

/**
 * The one confirmation dialog of the app (Archive, Reprocess). Radix gives it the focus trap, Esc
 * to close, and focus back to the button that opened it. Focus starts on the primary button, so
 * Enter confirms; Tab reaches Cancel. While the request runs both buttons are disabled and Esc
 * does nothing. A failure stays in the dialog as readable text, and the dialog stays open.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: ProblemMessage | null;
  onConfirm: () => void;
  /**
   * The button that opened the dialog. Radix only returns focus to its own Trigger, and this
   * dialog is opened from many row buttons, so the opener is passed in and focused on close.
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo?.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">{children}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger-bg px-3 py-2 text-[13px] text-ink"
          >
            <p className="font-semibold text-danger">{error.title}</p>
            <p>{error.message}</p>
            {error.items.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {error.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button ref={confirmRef} type="button" disabled={pending} onClick={onConfirm}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
