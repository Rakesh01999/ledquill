"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LogoLink } from "./logo";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { ApiStatus } from "./api-status";
import { GlobalSearch } from "./global-search";

export function Topbar() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <header className="flex h-14 flex-none items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation">
            <Menu className="size-4" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 gap-0 bg-surface p-3">
          <SheetHeader className="p-0 pb-4">
            <SheetTitle className="px-2">
              <LogoLink onNavigate={() => setDrawerOpen(false)} />
            </SheetTitle>
            <SheetDescription className="sr-only">Navigate between screens</SheetDescription>
          </SheetHeader>
          <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          <div className="mt-auto border-t border-line px-2.5 pt-3">
            <ApiStatus />
            <p className="mt-3 text-[11px] text-ink-3">© 2026 LedQuill</p>
          </div>
        </SheetContent>
      </Sheet>

      <div className="md:hidden">
        <LogoLink showName={false} />
      </div>
      <div className="flex-1" />

      <GlobalSearch />
      <ThemeToggle />
    </header>
  );
}
