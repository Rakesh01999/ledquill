"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Archive, CornerDownLeft, FileText, Loader2, Receipt, Search, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/shared/status-chip";
import { api } from "@/lib/api/client";
import { describeError } from "@/lib/api/problem";
import {
  MAX_QUERY,
  MIN_QUERY,
  buildGroups,
  highlightParts,
  type ResultGroup,
  type ResultRow,
} from "@/lib/global-search";
import { useShortcuts } from "@/lib/shortcuts";
import { globalSearchOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";
import { matchItems, type PaletteItem } from "./palette-items";

const ICONS: Record<ResultRow["kind"], LucideIcon> = {
  invoice: Receipt,
  document: FileText,
};

/** The text with the query marked. Plain React text nodes: user input can never become markup. */
function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-sm bg-primary-soft px-px font-semibold text-link">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The top-bar search: a button that looks like a search field and opens a command palette (a
 * dialog, so it renders in a portal and never changes the page's size). Ctrl/Cmd+K opens it from
 * anywhere, "/" from anywhere that is not a text field. One request per pause in typing (250 ms),
 * the previous one is cancelled. Arrow keys move, Enter opens, Escape closes, and focus goes back to
 * where it was.
 */
export function GlobalSearch() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-list`;

  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const openPalette = useCallback(() => {
    const el = document.activeElement;
    returnTo.current = el instanceof HTMLElement && el !== document.body ? el : null;
    setOpen(true);
  }, []);

  // Ctrl/Cmd+K works everywhere, even inside a field: it cannot be typed text.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!event.repeat && !openRef.current) openPalette();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPalette]);
  // "/" only when no field has focus and no dialog is open (useShortcuts checks both).
  useShortcuts(useMemo(() => ({ "/": openPalette }), [openPalette]));

  // Debounce the text. A too-short text is never searched (see `searchable` below).
  useEffect(() => {
    const q = text.trim();
    if (q.length < MIN_QUERY) return;
    const timer = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const trimmed = text.trim();
  const searchable = trimmed.length >= MIN_QUERY;
  const settled = searchable ? debounced : "";
  const query = useQuery({ ...globalSearchOptions(api, settled), enabled: open && settled.length >= MIN_QUERY });
  // Results belong to `debounced`; while the text has moved on they are the previous ones, shown dimmed.
  const groups: ResultGroup[] = useMemo(() => (query.data && settled ? buildGroups(query.data) : []), [query.data, settled]);
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  // Pages and the theme action: matched here, at once, with no request. They come before the
  // server groups, and the keyboard walks one flat list (static items first).
  const staticItems = useMemo(() => matchItems(trimmed), [trimmed]);
  const staticCount = staticItems.length;
  const optionCount = staticCount + rows.length;
  const current = Math.min(active, Math.max(0, optionCount - 1));
  const pending = searchable && (trimmed !== settled || query.isFetching);
  const stale = searchable && trimmed !== settled;
  const failed = query.isError && searchable && trimmed === settled;

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, optionCount]);

  /** Every way of closing (Escape, a click outside, a result, the Close button) ends up here. */
  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setText("");
      setDebounced("");
      setActive(0);
    }
  }
  const close = () => changeOpen(false);

  function go(href: string) {
    close();
    router.push(href);
  }

  function runItem(item: PaletteItem) {
    if (item.kind === "page") go(item.href);
    else {
      close();
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    }
  }

  function openAt(index: number) {
    const item = staticItems[index];
    if (item) return runItem(item);
    const row = rows[index - staticCount];
    if (row) go(row.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") setActive(optionCount === 0 ? 0 : (current + 1) % optionCount);
    else if (event.key === "ArrowUp") setActive(optionCount === 0 ? 0 : (current - 1 + optionCount) % optionCount);
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(Math.max(0, optionCount - 1));
    else if (event.key === "Enter") {
      if (event.nativeEvent.isComposing) return;
      // A page or action is current at once; a server row only once its results match the text.
      if (optionCount > 0 && (current < staticCount || !stale)) openAt(current);
    } else return;
    event.preventDefault();
  }

  // Where each group starts in the flat list of options (arrow keys walk the flat list).
  const starts = groups.map((_, i) => groups.slice(0, i).reduce((n, g) => n + g.rows.length, 0));
  const status = !searchable
    ? ""
    : failed
      ? "Search failed."
      : pending
        ? "Searching"
        : optionCount === 0
          ? "No results."
          : `${optionCount} ${optionCount === 1 ? "result" : "results"}`;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K /"
        className="relative hidden h-8 w-full max-w-[380px] items-center rounded-md border border-line-control bg-canvas pr-2 pl-8 text-left text-table text-ink-3 outline-none hover:border-line-strong sm:flex"
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Search invoices, documents, suppliers, amounts</span>
        <kbd aria-hidden="true" className="rounded-sm border border-line px-1.5 font-mono text-[11px]">
          /
        </kbd>
      </button>
      {/* Below sm the field has no room: an icon button opens the same palette. */}
      <Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label="Search" onClick={openPalette}>
        <Search className="size-4" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={`${id}-help`}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            // Back to the element that had focus when the palette opened (the button, if none had).
            e.preventDefault();
            const target = returnTo.current;
            (target && document.contains(target) ? target : trigger.current)?.focus();
          }}
          className="top-[max(0.5rem,6dvh)] flex max-h-[calc(100dvh_-_max(0.5rem,6dvh)_-_0.5rem)] w-[calc(100vw-1rem)] max-w-[640px] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-[640px]"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription id={`${id}-help`} className="sr-only">
            Search invoices, documents, suppliers and archived items. Arrow keys move, Enter opens, Escape closes.
          </DialogDescription>
          {/* p-3 leaves room for the global 2px focus outline (offset 2px) inside the dialog's clip. */}
          <div className="flex items-center gap-2 border-b border-line p-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
              <input
                ref={input}
                role="combobox"
                aria-expanded={optionCount > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-label="Search invoices, documents, suppliers and amounts"
                aria-activedescendant={optionCount > 0 ? `${id}-opt-${current}` : undefined}
                value={text}
                maxLength={MAX_QUERY}
                onChange={(e) => {
                  setText(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Invoice number, supplier, amount, file name or id"
                autoComplete="off"
                spellCheck={false}
                className="h-11 w-full rounded-md border border-line-control bg-surface pr-9 pl-9 text-table text-ink outline-none placeholder:text-ink-3 sm:h-10"
              />
              {pending && (
                <Loader2
                  className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-ink-3"
                  role="status"
                  aria-label="Searching"
                />
              )}
            </div>
            <Button variant="ghost" size="sm" className="sm:hidden" onClick={close}>
              Close
            </Button>
          </div>

          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label="Search results"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {staticCount > 0 && (
              <div role="group" aria-labelledby={`${id}-g-pages`} className="py-1">
                <div id={`${id}-g-pages`} className="px-3 pt-2 pb-1 text-xs font-medium text-ink-2">
                  Pages and actions
                </div>
                {staticItems.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.key}
                      id={`${id}-opt-${i}`}
                      role="option"
                      aria-selected={i === current}
                      data-index={i}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => setActive(i)}
                      onClick={() => runItem(item)}
                      className={cn("flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2", i === current && "bg-primary-soft")}
                    >
                      <Icon className="size-4 flex-none text-ink-2" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-table font-medium">
                        <Highlight text={item.label} query={trimmed} />
                      </span>
                      <span className="flex-none text-xs text-ink-3">{item.kind === "page" ? "Page" : "Action"}</span>
                      {i === current && <CornerDownLeft className="size-3.5 flex-none text-ink-3" aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Only the server results dim while the text has moved on; pages and actions never do. */}
            <div className={cn(stale && "opacity-60 transition-opacity")}>
            {groups.map((group, groupIndex) => {
              const start = starts[groupIndex] ?? 0;
              return (
                <div key={group.key} role="group" aria-labelledby={`${id}-g-${group.key}`} className="py-1">
                  <div id={`${id}-g-${group.key}`} className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs font-medium text-ink-2">
                    {group.key === "archived" && <Archive className="size-3" aria-hidden="true" />}
                    {group.label}
                    {group.key === "archived" && (
                      <span className="font-normal text-ink-3">Hidden from lists and the dashboard</span>
                    )}
                  </div>
                  {group.rows.map((row, i) => {
                    const index = staticCount + start + i;
                    const Icon = row.archived ? Archive : ICONS[row.kind];
                    return (
                      <div
                        key={row.key}
                        id={`${id}-opt-${index}`}
                        role="option"
                        aria-selected={index === current}
                        data-index={index}
                        // Keep focus in the input: a mousedown on the row would take it away.
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseMove={() => setActive(index)}
                        onClick={() => go(row.href)}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 px-3 py-2",
                          index === current && "bg-primary-soft",
                          row.archived && "border-l-2 border-line-strong",
                        )}
                      >
                        <Icon className="size-4 flex-none text-ink-2" aria-hidden="true" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-2">
                            <span className={cn("min-w-0 truncate text-table font-medium", row.kind === "invoice" && "font-mono")}>
                              <Highlight text={row.title} query={trimmed} />
                            </span>
                            {row.archived && (
                              <span className="flex-none rounded-sm border border-line-strong px-1 text-[11px] font-medium text-ink-2">
                                Archived
                              </span>
                            )}
                            {row.status && <StatusChip status={row.status} className="flex-none" />}
                          </span>
                          <span className="truncate text-xs text-ink-2">
                            <Highlight text={row.detail} query={trimmed} />
                          </span>
                        </span>
                        {index === current && <CornerDownLeft className="size-3.5 flex-none text-ink-3" aria-hidden="true" />}
                      </div>
                    );
                  })}
                  {group.more && group.key !== "archived" && (
                    <p className="px-3 py-1 text-xs text-ink-3">More match. Add words to narrow the search.</p>
                  )}
                  {group.more && group.key === "archived" && (
                    <p className="px-3 py-1 text-xs text-ink-3">
                      More archived items match.{" "}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => go("/archived")}
                        className="text-link hover:underline"
                      >
                        Open the archive
                      </button>
                    </p>
                  )}
                </div>
              );
            })}
            </div>

            {!searchable && (
              <p className={cn("px-4 text-center text-table text-ink-2", staticCount > 0 ? "py-3" : "py-8")}>
                {trimmed.length === 0
                  ? "Or search invoices and documents: type an invoice number, supplier, amount such as 2,970.00, file name or id."
                  : `Type at least ${MIN_QUERY} characters to search invoices and documents.`}
              </p>
            )}
            {searchable && !pending && rows.length === 0 && !failed && (
              <p className={cn("px-4 text-center text-table text-ink-2", staticCount > 0 ? "py-3" : "py-8")}>
                {staticCount > 0 ? "No invoices or documents match" : "Nothing matches"} “
                <span className="break-all">{trimmed}</span>”.
                {staticCount > 0 ? "" : " Check the spelling or try fewer words."}
              </p>
            )}
            {failed && (
              <div role="alert" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <p className="text-table text-ink-2">
                  {describeError(query.error).title}. {describeError(query.error).message}
                </p>
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-xs text-ink-3">
            <span role="status" aria-live="polite" className="tabular-nums">
              {status}
            </span>
            <span className="hidden gap-3 sm:flex" aria-hidden="true">
              <span>↑↓ move</span>
              <span>Enter open</span>
              <span>Esc close</span>
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
