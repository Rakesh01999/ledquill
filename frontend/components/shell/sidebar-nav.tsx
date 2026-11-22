"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { statsOptions } from "@/lib/query/options";
import { CountBadge } from "@/components/shared/count-badge";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

/** Review count from /stats, as the orange badge. */
function ReviewBadge({ dot = false }: { dot?: boolean }) {
  const { data } = useQuery(statsOptions(api));
  const count = data?.needs_review ?? 0;
  if (count <= 0) return null;
  if (dot) {
    // Icon-only sidebar: a small marker on the icon; the count is in the accessible name.
    return (
      <span
        className="absolute top-1 right-2 size-2 rounded-full bg-accent-mark"
        role="img"
        aria-label={`${count} invoices need review`}
      />
    );
  }
  return <CountBadge count={count} />;
}

/** Navigation list. `collapsed` shows icons only (tablet widths); labels stay for screen readers. */
export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  // An invoice opened from the review queue (?queue=1) belongs to the Review queue item.
  const fromQueue = useSearchParams().get("queue") === "1" && pathname.startsWith("/invoices/");
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = fromQueue
          ? item.href === "/review"
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors",
              collapsed && "justify-center px-0",
              active
                ? "bg-primary-soft font-semibold text-link"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon className="size-4 flex-none" strokeWidth={1.6} aria-hidden="true" />
            <span className={cn("flex-1 truncate", collapsed && "sr-only")}>{item.label}</span>
            {item.badge === "review" && <ReviewBadge dot={collapsed} />}
          </Link>
        );
      })}
    </nav>
  );
}
