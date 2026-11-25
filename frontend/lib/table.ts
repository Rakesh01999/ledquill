/** Shared table look: every table has the same row height and header style. */
export const ROW = "h-[53px]";

/**
 * Header cell style. The cells are sticky at `--table-head-top`, which the page header sets (see
 * components/shell/sticky-offset.tsx), so the column header stays directly under the sticky page
 * header while the table scrolls and leaves with the table. The inset shadow is the header's
 * bottom border: borders of a collapsed table do not travel with sticky cells.
 */
export const HEAD =
  "sticky top-[var(--table-head-top)] z-10 bg-surface-2 text-xs font-medium text-ink-2 shadow-[inset_0_-1px_0_var(--line)]";
