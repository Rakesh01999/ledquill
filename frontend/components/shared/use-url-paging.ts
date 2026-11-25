"use client";

import { useSearchParams } from "next/navigation";
import { DEFAULT_PAGE_SIZE, parseSize } from "@/lib/paging";

/**
 * Paging for a list that is already fully loaded (the API sent at most 100 rows), with the page
 * and size kept in the URL like the server-paged lists, so a breadcrumb or Back returns to them.
 */
export function useUrlPaging<T>(items: T[], path: string) {
  const params = useSearchParams();
  const size = parseSize(params.get("size") ?? undefined);
  const wanted = Number.parseInt(params.get("page") ?? "1", 10);
  const last = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Number.isFinite(wanted) && wanted >= 1 ? wanted : 1, last);

  const href = (target: number, rows: number) => {
    const q = new URLSearchParams();
    if (rows !== DEFAULT_PAGE_SIZE) q.set("size", String(rows));
    if (target > 1) q.set("page", String(target));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };

  return {
    pageItems: items.slice((page - 1) * size, page * size),
    pagerProps: {
      page,
      pageSize: size,
      total: items.length,
      hrefFor: (target: number) => href(target, size),
      sizeHref: (rows: number) => href(1, rows),
    },
  };
}
