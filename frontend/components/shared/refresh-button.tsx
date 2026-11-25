"use client";

import { useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshQueries } from "@/lib/query/refresh";
import { cn } from "@/lib/utils";

/** Long enough to see that something happened when the answer comes back at once. */
const MIN_SPIN_MS = 450;

/**
 * Small icon button at the top of a table: refetches that table's queries and the dashboard
 * numbers. Spins and stays disabled while it runs; the spin stops for visitors who ask for
 * reduced motion (the button then just dims).
 */
export function RefreshButton({ label, queryKeys }: { label: string; queryKeys: QueryKey[] }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    try {
      await Promise.all([refreshQueries(queryClient, queryKeys), new Promise((r) => setTimeout(r, MIN_SPIN_MS))]);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        disabled={pending}
        aria-busy={pending}
        onClick={() => void run()}
        className="text-ink-2"
      >
        <RefreshCw className={cn(pending && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      </Button>
      <span role="status" className="sr-only">
        {pending ? "Refreshing" : ""}
      </span>
    </>
  );
}
