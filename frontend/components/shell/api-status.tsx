"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { healthOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";
import { NavTooltip } from "./nav-tooltip";

/** Connection to the API through the server-side proxy. Text and icon, never colour alone. */
export function ApiStatus({ compact = false }: { compact?: boolean }) {
  const { data, isPending, isError } = useQuery(healthOptions(api));
  const ok = !isError && data?.ok === true;
  const label = isPending ? "Checking connection" : ok ? "API connected" : "API unreachable";
  const Icon = ok || isPending ? CircleCheck : CircleAlert;
  const body = (
    <div
      role="status"
      aria-label={compact ? label : undefined}
      tabIndex={compact ? 0 : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md text-xs outline-none focus-visible:outline-2 focus-visible:outline-primary",
        compact && "justify-center py-1",
        isPending ? "text-ink-3" : ok ? "text-ok" : "text-danger",
      )}
    >
      <Icon className="size-3.5 flex-none" aria-hidden="true" />
      {!compact && <span>{label}</span>}
    </div>
  );
  return compact ? (
    <NavTooltip label={label} enabled>
      {body}
    </NavTooltip>
  ) : (
    body
  );
}
