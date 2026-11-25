"use client";

import { useCallback, useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isTyping } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { ApiStatus } from "./api-status";
import { LogoLink } from "./logo";
import { NavTooltip } from "./nav-tooltip";
import { SidebarNav } from "./sidebar-nav";
import { SIDEBAR_COOKIE } from "./sidebar-state";

const SIDEBAR_ID = "app-sidebar";

function persist(collapsed: boolean): void {
  // The server reads this cookie on the next request, so the first paint already has the right width.
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Desktop sidebar (md and up; below that the top bar's drawer is used). Expanded 256px, collapsed
 * 64px with icons only. Ctrl/Cmd+B toggles it unless focus is in a text field.
 */
export function Sidebar({ initialCollapsed }: { initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((value) => !value);
  }, []);

  useEffect(() => {
    persist(collapsed);
  }, [collapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "b" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.repeat || isTyping(event.target)) return;
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <aside
      id={SIDEBAR_ID}
      data-collapsed={collapsed}
      className={cn(
        "hidden h-dvh flex-none flex-col overflow-x-hidden border-r border-line bg-surface px-3 pt-3.5 transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div
        className={cn(
          "flex flex-none pb-[18px]",
          collapsed ? "flex-col items-center gap-3" : "items-center justify-between pl-1",
        )}
      >
        <LogoLink showName={!collapsed} />
        <NavTooltip label={`${toggleLabel} (Ctrl+B)`} enabled={collapsed}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls={SIDEBAR_ID}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Button>
        </NavTooltip>
      </div>
      {/* The list scrolls inside the sidebar only if it ever overflows; the footer stays put. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <SidebarNav collapsed={collapsed} />
      </div>
      <div className={cn("flex-none border-t border-line pt-3 pb-3.5", !collapsed && "px-1")}>
        <ApiStatus compact={collapsed} />
        {!collapsed && <p className="mt-3 text-[11px] whitespace-nowrap text-ink-3">© 2026 LedQuill</p>}
      </div>
    </aside>
  );
}
