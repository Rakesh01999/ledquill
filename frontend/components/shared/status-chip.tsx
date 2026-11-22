import { BadgeCheck, CircleAlert, CircleCheck, Clock, Loader, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "danger" | "primary" | "idle";

const TONES: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  primary: "bg-primary-soft text-link",
  idle: "bg-idle-bg text-idle",
};

/** Every status the UI shows: label (sentence case), tone and icon. Text plus icon plus colour. */
const STATUSES: Record<string, { label: string; tone: Tone; icon: LucideIcon; spin?: boolean }> = {
  queued: { label: "Queued", tone: "idle", icon: Clock },
  processing: { label: "Processing", tone: "idle", icon: Loader, spin: true },
  completed: { label: "Completed", tone: "ok", icon: CircleCheck },
  failed: { label: "Failed", tone: "danger", icon: CircleAlert },
  needs_review: { label: "Needs review", tone: "warn", icon: TriangleAlert },
  ready: { label: "Ready", tone: "ok", icon: CircleCheck },
  approved: { label: "Approved", tone: "primary", icon: BadgeCheck },
};

export function StatusChip({ status, className }: { status: string; className?: string }) {
  const known = STATUSES[status];
  const { label, tone, icon: Icon, spin } = known ?? {
    label: status.replace(/_/g, " "),
    tone: "idle" as Tone,
    icon: Clock,
    spin: false,
  };
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      <Icon className={cn("size-3", spin && "motion-safe:animate-spin")} aria-hidden="true" />
      {label}
    </span>
  );
}
