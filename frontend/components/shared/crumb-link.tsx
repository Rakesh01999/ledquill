"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { markRestore, recallList } from "@/lib/list-state";

/**
 * A breadcrumb link. When it points at a list page, it goes back to the last view of that list
 * (page, size, filters, search, scroll position) instead of the bare list.
 */
export function CrumbLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        const saved = recallList(href);
        if (!saved || saved === href) return;
        event.preventDefault();
        markRestore(saved);
        router.push(saved);
      }}
    >
      {children}
    </Link>
  );
}
