"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LogoLink } from "./logo";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { ApiStatus } from "./api-status";
import { useShortcuts } from "@/lib/shortcuts";

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // On the invoices page the box shows the search that is in the URL, so it never disagrees with it.
  const urlQuery = useSearchParams().get("q") ?? "";
  const shownUrlQuery = pathname === "/invoices" ? urlQuery : "";
  const [query, setQuery] = useState(shownUrlQuery);
  const [seenUrlQuery, setSeenUrlQuery] = useState(shownUrlQuery);
  if (shownUrlQuery !== seenUrlQuery) {
    // Adjust state while rendering, the React-recommended way to follow a changed value.
    setSeenUrlQuery(shownUrlQuery);
    setQuery(shownUrlQuery);
  }
  const searchInput = useRef<HTMLInputElement>(null);
  // "/" jumps to the search field from anywhere that is not a text field.
  useShortcuts(useMemo(() => ({ "/": () => searchInput.current?.focus() }), []));

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    router.push(q ? `/invoices?q=${encodeURIComponent(q)}` : "/invoices");
  }

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

      <form role="search" onSubmit={submit} className="relative hidden w-full max-w-[380px] sm:block">
        <label htmlFor="global-search" className="sr-only">
          Search invoices
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
        <input
          ref={searchInput}
          id="global-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search invoices, suppliers, amounts"
          className="h-8 w-full rounded-md border border-line bg-canvas pr-8 pl-8 text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        {!query && (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-sm border border-line px-1.5 font-mono text-[11px] text-ink-3"
          >
            /
          </kbd>
        )}
      </form>
      <ThemeToggle />
    </header>
  );
}
