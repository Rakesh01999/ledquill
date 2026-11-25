"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label?: string; /** Shown at the right, e.g. a count. */ hint?: string | number };

/** What the trigger says for the current selection. */
export function summarize(selected: string[], anyLabel = "Any"): string {
  if (selected.length === 0) return anyLabel;
  if (selected.length === 1) return selected[0] ?? anyLabel;
  return `${selected.length} selected`;
}

/**
 * A searchable multi-select dropdown (ARIA combobox + listbox in a popover). Type to filter, Arrow
 * keys / Home / End move, Enter or click toggles, Escape closes and returns to the button.
 *
 * Filtering is local unless `onQueryChange` is given: then the caller supplies options for the
 * typed text (a server search) and nothing is filtered here. The popover renders in a portal.
 */
export function Combobox({
  label,
  options,
  selected,
  onChange,
  onQueryChange,
  loading = false,
  error = false,
  anyLabel = "Any",
  searchPlaceholder = "Search",
  emptyText = "No matches",
  className,
}: {
  label: string;
  options: ComboOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  error?: boolean;
  anyLabel?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Server search: tell the caller what was typed, once typing pauses.
  useEffect(() => {
    if (!onQueryChange) return;
    const timer = setTimeout(() => onQueryChange(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query, onQueryChange]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = onQueryChange || !needle ? options : options.filter((o) => (o.label ?? o.value).toLowerCase().includes(needle));
    // A chosen value that the current list does not hold (e.g. narrowed away) stays reachable at the top.
    const missing: ComboOption[] = needle
      ? []
      : selected.filter((v) => !options.some((o) => o.value === v)).map((v) => ({ value: v }));
    return [...missing, ...base];
  }, [options, query, selected, onQueryChange]);

  const current = Math.min(active, Math.max(0, shown.length - 1));
  // The selection often lives in the URL, which updates a beat after onChange. Two quick toggles
  // must both count, so the latest choice is kept here until the prop catches up.
  const latest = useRef(selected);
  useEffect(() => {
    latest.current = selected;
  }, [selected]);
  const toggle = (value: string) => {
    const base = latest.current;
    const next = base.includes(value) ? base.filter((v) => v !== value) : [...base, value];
    latest.current = next;
    onChange(next);
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, open]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = shown.length - 1;
    if (event.key === "ArrowDown") setActive(current >= last ? 0 : current + 1);
    else if (event.key === "ArrowUp") setActive(current <= 0 ? Math.max(0, last) : current - 1);
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(Math.max(0, last));
    else if (event.key === "Enter") {
      const option = shown[current];
      if (option) toggle(option.value);
    } else return;
    event.preventDefault();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <div className={cn("flex flex-col gap-1 text-xs text-ink-2", className)}>
        <span id={`${id}-label`}>{label}</span>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby={`${id}-label ${id}-value`}
            className={cn(
              "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-left text-[13px] outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary",
              selected.length === 0 ? "text-ink-3" : "text-ink",
            )}
          >
            <span id={`${id}-value`} className="truncate">
              {summarize(selected, anyLabel)}
            </span>
            <ChevronDown className="size-3.5 flex-none text-ink-3" aria-hidden="true" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64" onOpenAutoFocus={(e) => {
        // Focus the search box, not the popover frame.
        e.preventDefault();
        document.getElementById(`${id}-input`)?.focus();
      }}>
        <div className="flex items-center gap-2 border-b border-line px-2.5">
          <Search className="size-3.5 flex-none text-ink-3" aria-hidden="true" />
          <input
            id={`${id}-input`}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={`Search ${label.toLowerCase()}`}
            aria-activedescendant={shown.length > 0 ? `${id}-opt-${current}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            autoComplete="off"
            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          {loading && <Loader2 className="size-3.5 flex-none animate-spin text-ink-3" aria-label="Loading" />}
        </div>
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="max-h-60 overflow-y-auto overscroll-contain py-1"
        >
          {shown.map((option, i) => {
            const isSelected = selected.includes(option.value);
            return (
              <li
                key={option.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={isSelected}
                data-index={i}
                // The input keeps focus; a mousedown here would take it away.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle(option.value)}
                onMouseMove={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px] text-ink",
                  i === current && "bg-surface-2",
                )}
              >
                <span className="flex size-4 flex-none items-center justify-center">
                  {isSelected && <Check className="size-3.5 text-link" aria-hidden="true" />}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", isSelected && "font-medium")} title={option.label ?? option.value}>
                  {option.label ?? option.value}
                </span>
                {option.hint !== undefined && <span className="flex-none text-xs text-ink-3 tabular-nums">{option.hint}</span>}
              </li>
            );
          })}
        </ul>
        {shown.length === 0 && (
          <p role="status" className="px-3 py-4 text-center text-[13px] text-ink-2">
            {error ? "Could not load the list." : loading ? "Loading" : emptyText}
          </p>
        )}
        {selected.length > 0 && (
          <div className="border-t border-line px-2.5 py-1.5">
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded-sm text-xs font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              Clear selection ({selected.length})
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
