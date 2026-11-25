import { PageHeader } from "@/components/shared/page-header";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-view";

export default function DashboardLoading() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <DashboardSkeleton />
    </>
  );
}
