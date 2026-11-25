/** Rows per page offered on every list. The API allows at most 100 (backend/app/core/pagination.py). */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Read `size` from the URL: only the offered values count, anything else is the default. */
export function parseSize(value: string | undefined): number {
  const n = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}
