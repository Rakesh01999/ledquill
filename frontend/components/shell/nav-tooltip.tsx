"use client";

import { useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Tooltip to the right of an icon-only control. Only active while `enabled` (sidebar collapsed);
 * when off, children render as they are. Opens on hover and on keyboard focus after a short delay,
 * closes on click, and renders in a portal so the sidebar's overflow never clips it.
 */
export function NavTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Hover while expanded must not leave a stale "open" that pops up once the sidebar collapses.
  if (!enabled && open) setOpen(false);
  return (
    <Tooltip open={enabled && open} onOpenChange={(next) => setOpen(enabled && next)} delayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
