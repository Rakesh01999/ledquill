import type { ReactNode } from "react";
import { ScrollRestore } from "./scroll-restore";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * App shell. The sidebar is collapsible (icons only) from 768px and replaced by a drawer (opened
 * from the top bar) below that. `initialCollapsed` comes from a cookie so the first paint is right.
 */
export function AppShell({ children, initialCollapsed = false }: { children: ReactNode; initialCollapsed?: boolean }) {
  return (
    <div className="flex h-dvh min-h-0">
      <Sidebar initialCollapsed={initialCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <ScrollRestore />
        {/* `relative` makes <main> the containing block of absolutely positioned descendants (the
            screen-reader-only text). Without it they are placed against the viewport, are not clipped
            by <main>'s scrolling, and stretch the document, so the whole page (sidebar included)
            scrolls and leaves empty space under the content. */}
        <main id="main" className="relative min-h-0 flex-1 overflow-y-auto p-page">
          {children}
        </main>
      </div>
    </div>
  );
}
