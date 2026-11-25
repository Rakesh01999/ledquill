import type { ReactNode } from "react";
import { ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown on the page of an archived document or invoice: what it means, and the way back. */
export function ArchivedNotice({
  title,
  children,
  onRestore,
  restoring,
  restoreLabel,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  onRestore: () => void;
  restoring: boolean;
  restoreLabel: string;
  /** The way back is blocked (the API would refuse); the text says why. */
  disabled?: boolean;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line-strong bg-surface-2 px-4 py-3 text-[13px]"
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-ink-2">{children}</p>
      </div>
      <Button variant="outline" size="sm" disabled={restoring || disabled} onClick={onRestore}>
        <ArchiveRestore aria-hidden="true" /> {restoring ? "Restoring" : restoreLabel}
      </Button>
    </div>
  );
}
