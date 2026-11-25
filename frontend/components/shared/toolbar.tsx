import type { ReactNode } from "react";

/** The panel that holds a list's search, filters and active-filter chips. Same on every list. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">{children}</div>;
}
