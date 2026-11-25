import type { Metadata } from "next";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { statsOptions } from "@/lib/query/options";
import { getQueryClient, prefetch } from "@/lib/query/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await prefetch(statsOptions);
  return (
    <>
      <PageHeader title="Dashboard" />
      <HydrationBoundary state={dehydrate(getQueryClient())}>
        <DashboardView />
      </HydrationBoundary>
    </>
  );
}
