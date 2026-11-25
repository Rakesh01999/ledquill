"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cameFromList, markRestore, recallList } from "@/lib/list-state";

/**
 * Back to the list the user came from, exactly as they left it: history Back keeps the search,
 * filters, sort, page, size and scroll position (the URL carries them, ScrollRestore restores the
 * scroll). With no list before this page (a direct link, a reload, or a page reached through other
 * pages), it goes to the last remembered view of `fallback`, or to `fallback` itself.
 */
export function BackButton({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      onClick={() => {
        if (cameFromList()) {
          router.back();
          return;
        }
        const target = recallList(fallback) ?? fallback;
        markRestore(target);
        router.push(target);
      }}
    >
      <ArrowLeft aria-hidden="true" /> {label}
    </Button>
  );
}
