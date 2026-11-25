import type { ReactNode } from "react";

/** The strip at the top of a table card: what the table shows on the left, its refresh button on the right. */
export function TableBar({ children, refresh }: { children?: ReactNode; refresh: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-line px-4 py-1">
      <div className="min-w-0 flex-1 text-xs text-ink-2">{children}</div>
      <div className="flex flex-none items-center">{refresh}</div>
    </div>
  );
}
