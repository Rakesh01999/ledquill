import type { ReactNode } from "react";
import { ApiStatus } from "./api-status";
import { LogoMark } from "./logo";
import { SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";

/**
 * App shell, rendered on the server. Sidebar is full width from 1024px, icons only from 768px,
 * and replaced by a drawer (opened from the top bar) below that.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh min-h-0">
      <aside className="hidden w-14 flex-none flex-col border-r border-line bg-surface px-2 py-3.5 md:flex lg:w-[232px] lg:px-3">
        <div className="flex items-center gap-2.5 px-1 pb-[18px] lg:px-2">
          <LogoMark />
          <div className="hidden lg:block">
            <div className="text-sm leading-tight font-semibold">LedQuill</div>
            <div className="text-[11px] text-ink-3">Care Guide Ltd</div>
          </div>
        </div>
        <div className="lg:hidden">
          <SidebarNav collapsed />
        </div>
        <div className="hidden lg:block">
          <SidebarNav />
        </div>
        <div className="flex-1" />
        <div className="border-t border-line px-1 pt-3 lg:px-2.5">
          <div className="lg:hidden">
            <ApiStatus compact />
          </div>
          <div className="hidden lg:block">
            <ApiStatus />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
