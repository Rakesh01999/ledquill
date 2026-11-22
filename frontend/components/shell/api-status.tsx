"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { healthOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";

/** Connection to the API through the server-side proxy. Text and icon, never colour alone. */
export function ApiStatus({ compact = false }: { compact?: boolean }) {
  const { data, isPending, isError } = useQuery(healthOptions(api));
  const ok = !isError && data?.ok === true;
  const label = isPending ? "Checking connection" : ok ? "API connected" : "API unreachable";
  const Icon = ok || isPending ? CircleCheck : CircleAlert;
  return (
    <div
      role="status"
      title={compact ? label : undefined}
      className={cn(
        "flex items-center gap-2 text-xs",
        compact && "justify-center",
        isPending ? "text-ink-3" : ok ? "text-ok" : "text-danger",
      )}
    >
      <Icon className="size-3.5 flex-none" aria-hidden="true" />
      <span className={cn(compact && "sr-only")}>{label}</span>
    </div>
  );
}
