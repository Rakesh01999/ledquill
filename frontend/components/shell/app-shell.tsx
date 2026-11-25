import type { ReactNode } from "react";
import { ApiStatus } from "./api-status";
import { LogoLink } from "./logo";
import { ScrollRestore } from "./scroll-restore";
import { SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";

/**
 * App shell, rendered on the server. Sidebar is full width from 1024px, icons only from 768px,
 * and replaced by a drawer (opened from the top bar) below that.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh min-h-0">
      <aside className="hidden h-dvh w-14 flex-none flex-col border-r border-line bg-surface px-2 pt-3.5 md:flex lg:w-[232px] lg:px-3">
        <div className="flex-none px-1 pb-[18px] lg:px-2">
          <div className="lg:hidden">
            <LogoLink showName={false} />
          </div>
          <div className="hidden lg:block">
            <LogoLink />
          </div>
        </div>
        {/* The list scrolls inside the sidebar only if it ever overflows; the footer stays put. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="lg:hidden">
            <SidebarNav collapsed />
          </div>
          <div className="hidden lg:block">
            <SidebarNav />
          </div>
        </div>
        <div className="flex-none border-t border-line px-1 pt-3 pb-3.5 lg:px-2.5">
          <div className="lg:hidden">
            <ApiStatus compact />
          </div>
          <div className="hidden lg:block">
            <ApiStatus />
          </div>
          <p className="mt-3 hidden text-[11px] text-ink-3 lg:block">© 2026 LedQuill</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <ScrollRestore />
        {/* `relative` makes <main> the containing block of absolutely positioned descendants (the
            screen-reader-only text). Without it they are placed against the viewport, are not clipped
            by <main>'s scrolling, and stretch the document, so the whole page (sidebar included)
            scrolls and leaves empty space under the content. */}
        <main id="main" className="relative min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
