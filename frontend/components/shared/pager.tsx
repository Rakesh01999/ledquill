"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { ReactNode } from "react";
import { ShallowLink } from "@/components/shared/shallow-link";
import { Button } from "@/components/ui/button";
import { PAGE_SIZES } from "@/lib/paging";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  /** Link mode: the page and size live in the URL (Documents, Invoices). */
  hrefFor?: (page: number) => string;
  sizeHref?: (size: number) => string;
  /** Button mode: the page and size live in component state (Review queue, Invoices found). */
  onPageChange?: (page: number) => void;
  onSizeChange?: (size: number) => void;
};

/**
 * "1–25 of 128", a rows-per-page select, and first / previous / next / last. In link mode every
 * control is a real link that only changes the URL, so the state is shareable and Back restores it.
 */
export function Pager({ page, pageSize, total, hrefFor, sizeHref, onPageChange, onSizeChange }: Props) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const last = Math.max(1, Math.ceil(total / pageSize));

  function control(label: string, target: number, enabled: boolean, icon: ReactNode) {
    if (!enabled) {
      return (
        <Button variant="ghost" size="icon-sm" disabled aria-label={label}>
          {icon}
        </Button>
      );
    }
    if (hrefFor) {
      return (
        <Button asChild variant="ghost" size="icon-sm">
          <ShallowLink href={hrefFor(target)} aria-label={label}>
            {icon}
          </ShallowLink>
        </Button>
      );
    }
    return (
      <Button variant="ghost" size="icon-sm" aria-label={label} onClick={() => onPageChange?.(target)}>
        {icon}
      </Button>
    );
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-2"
    >
      <div className="flex items-center gap-3 text-xs text-ink-2">
        <label className="flex items-center gap-2">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => {
              const size = Number(e.target.value);
              if (sizeHref) window.history.pushState(null, "", sizeHref(size));
              else onSizeChange?.(size);
            }}
            className="h-7 rounded-md border border-line-control bg-surface px-1.5 text-xs text-ink"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="tabular-nums" aria-live="polite">
          {from}–{to} of {total}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {control("First page", 1, page > 1, <ChevronsLeft aria-hidden="true" />)}
        {control("Previous page", page - 1, page > 1, <ChevronLeft aria-hidden="true" />)}
        <span className="px-1 text-xs text-ink-2 tabular-nums">
          {page} / {last}
        </span>
        {control("Next page", page + 1, page < last, <ChevronRight aria-hidden="true" />)}
        {control("Last page", last, page < last, <ChevronsRight aria-hidden="true" />)}
      </div>
    </nav>
  );
}
