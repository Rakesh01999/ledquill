"use client";

import { useState } from "react";
import { DEFAULT_PAGE_SIZE } from "@/lib/paging";

/** Paging for a list that is already fully loaded (the API sent at most 100 rows). */
export function useLocalPaging<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const last = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, last);
  return {
    pageItems: items.slice((current - 1) * size, current * size),
    pagerProps: {
      page: current,
      pageSize: size,
      total: items.length,
      onPageChange: setPage,
      onSizeChange: (next: number) => {
        setSize(next);
        setPage(1);
      },
    },
  };
}
