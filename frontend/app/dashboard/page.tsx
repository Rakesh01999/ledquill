import type { Metadata } from "next";
import { Suspense } from "react";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DashboardSkeleton, DashboardView } from "@/components/dashboard/dashboard-view";
import { statsOptions } from "@/lib/query/options";
import { getQueryClient, prefetch } from "@/lib/query/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await prefetch(statsOptions);
  return (
    <>
      <PageHeader title="Dashboard" />
      <HydrationBoundary state={dehydrate(getQueryClient())}>
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardView />
        </Suspense>
      </HydrationBoundary>
    </>
  );
}
