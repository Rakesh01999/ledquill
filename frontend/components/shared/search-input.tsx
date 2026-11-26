"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Search box that commits 300 ms after typing stops. `value` is the committed value (from the
 * URL); when it changes from outside, the draft follows. The input element never remounts, so it
 * keeps focus while results update. The clear button commits at once and refocuses the input;
 * Escape clears too. `loading` shows a spinner while a request for the committed value runs.
 */
export function SearchInput({
  id,
  value,
  onCommit,
  loading = false,
  delay = 300,
  placeholder,
  label,
  className,
}: {
  id: string;
  value: string;
  onCommit: (value: string) => void;
  loading?: boolean;
  delay?: number;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft.trim() === value.trim()) return;
    const timer = setTimeout(() => onCommit(draft), delay);
    return () => clearTimeout(timer);
  }, [draft, value, delay, onCommit]);

  function clear() {
    setDraft("");
    onCommit("");
    input.current?.focus();
  }

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden="true" />
      <input
        ref={input}
        id={id}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.preventDefault();
            clear();
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="h-8 w-full rounded-md border border-line-control bg-surface pr-14 pl-8 text-table text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
      />
      <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
        {loading && <Loader2 className="size-3.5 animate-spin text-ink-3" role="status" aria-label="Searching" />}
        {draft && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="flex size-6 items-center justify-center rounded-md text-ink-2 outline-none hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
