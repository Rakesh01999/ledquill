import { cn } from "@/lib/utils";

/** The review count. Orange is the fill; the number is dark ink (6.6:1), never orange text. */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-[18px] min-w-5 items-center justify-center rounded-full bg-accent-mark px-1.5 text-[11px] font-semibold text-badge-text tabular-nums",
        className,
      )}
      aria-label={`${count} ${count === 1 ? "invoice needs" : "invoices need"} review`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
