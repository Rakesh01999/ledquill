"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { statsOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

/** Orange count badge. Orange is a fill; the number is dark ink (6.6:1 on the fill). */
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
  return (
    <span
      className="flex h-[18px] min-w-5 items-center justify-center rounded-full bg-accent-mark px-1.5 text-[11px] font-semibold text-badge-text"
      aria-label={`${count} invoices need review`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Navigation list. `collapsed` shows icons only (tablet widths); labels stay for screen readers. */
export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
              "focus-visible:ring-2 focus-visible:ring-ring",
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
