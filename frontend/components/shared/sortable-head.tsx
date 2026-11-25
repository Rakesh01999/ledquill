"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { ShallowLink } from "@/components/shared/shallow-link";
import { TableHead } from "@/components/ui/table";
import { HEAD } from "@/lib/table";
import { cn } from "@/lib/utils";

/**
 * A column header that sorts. The header cell carries `aria-sort`; the control inside is a link
 * that only edits the URL (so Back restores the sort). Clicking the sorted column flips its
 * direction; clicking another one starts it in `defaultOrder`. `href` is built by the caller.
 */
export function SortableHead({
  children,
  direction,
  nextHref,
  align = "left",
  className,
}: {
  children: ReactNode;
  /** The direction this column is sorted in right now, or undefined when it is not the sort column. */
  direction?: "asc" | "desc";
  /** Where a click goes: the other direction, or this column in its default direction. */
  nextHref: string;
  align?: "left" | "right";
  className?: string;
}) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <TableHead
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      className={cn(HEAD, align === "right" && "text-right", className)}
    >
      <ShallowLink
        href={nextHref}
        className={cn(
          "-mx-1.5 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-primary",
          direction && "text-ink",
        )}
      >
        {children}
        <Icon className={cn("size-3 flex-none", direction ? "text-ink" : "text-ink-3")} aria-hidden="true" />
      </ShallowLink>
    </TableHead>
  );
}
