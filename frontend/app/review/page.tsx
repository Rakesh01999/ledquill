import type { Metadata } from "next";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { ReviewView } from "@/components/invoices/review-view";
import { queueOptions } from "@/lib/query/options";
import { getQueryClient, prefetch } from "@/lib/query/server";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewPage() {
  await prefetch(queueOptions);
  return (
    <HydrationBoundary state={dehydrate(getQueryClient())}>
      <ReviewView />
    </HydrationBoundary>
  );
}
