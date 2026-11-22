import type { Metadata } from "next";
import { DocumentDetail } from "@/components/documents/document-detail";
import { documentInvoicesOptions, documentOptions, eventsOptions, pagesOptions } from "@/lib/query/options";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getQueryClient, prefetch } from "@/lib/query/server";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Everything the first paint needs is fetched in parallel here and handed to the browser.
  await Promise.all([
    prefetch((c) => documentOptions(c, id)),
    prefetch((c) => eventsOptions(c, id)),
    prefetch((c) => pagesOptions(c, id)),
    prefetch((c) => documentInvoicesOptions(c, id)),
  ]);
  return (
    <HydrationBoundary state={dehydrate(getQueryClient())}>
      <DocumentDetail id={id} />
    </HydrationBoundary>
  );
}
