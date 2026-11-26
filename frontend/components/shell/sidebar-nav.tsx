"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { documentOptions, invoiceOptions, statsOptions } from "@/lib/query/options";
import { CountBadge } from "@/components/shared/count-badge";
import { cn } from "@/lib/utils";
import { NavTooltip } from "./nav-tooltip";
import { NAV_ITEMS } from "./nav";

/** Review count from /stats, as the orange badge. */
function ReviewBadge({ count, dot = false }: { count: number; dot?: boolean }) {
  if (count <= 0) return null;
  if (dot) {
    // Icon-only sidebar: a small marker on the icon; the count is in the link's accessible name.
    return <span aria-hidden="true" className="absolute top-1 right-2 size-2 rounded-full bg-accent-mark" />;
  }
  return <CountBadge count={count} />;
}

/** Navigation list. `collapsed` shows icons only, with a tooltip and an aria-label per link. */
export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  // An invoice opened from the review queue (?queue=1) belongs to the Review queue item.
  const fromQueue = useSearchParams().get("queue") === "1" && pathname.startsWith("/invoices/");
  // An archived invoice or document belongs to the Archived item. The page loads the same query,
  // so this reads the cache; it is only enabled on a detail page.
  const detail = /^\/(invoices|documents)\/([^/]+)$/.exec(pathname);
  const invoice = useQuery({ ...invoiceOptions(api, detail?.[2] ?? ""), enabled: detail?.[1] === "invoices" });
  const document = useQuery({ ...documentOptions(api, detail?.[2] ?? ""), enabled: detail?.[1] === "documents" });
  const archived = Boolean((detail?.[1] === "invoices" ? invoice.data : document.data)?.archived_at);
  const needsReview = useQuery(statsOptions(api)).data?.needs_review ?? 0;
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = archived
          ? item.href === "/archived"
          : fromQueue
            ? item.href === "/review"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const count = item.badge === "review" ? needsReview : 0;
        const name = collapsed && count > 0 ? `${item.label}, ${count} need review` : item.label;
        return (
          <NavTooltip key={item.href} label={name} enabled={collapsed}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? name : undefined}
              className={cn(
                "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-table outline-none transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                collapsed && "justify-center px-0",
                active
                  ? "bg-primary-soft font-semibold text-link"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="size-4 flex-none" strokeWidth={1.6} aria-hidden="true" />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {item.badge === "review" && <ReviewBadge count={count} dot={collapsed} />}
            </Link>
          </NavTooltip>
        );
      })}
    </nav>
  );
}
