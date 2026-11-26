import { PageHeader } from "@/components/shared/page-header";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Same structure as the review screen: one table card with its top bar. */
export function ReviewSkeleton() {
  return (
    <div className="flex flex-col gap-section" aria-busy="true">
      <div className="overflow-clip rounded-lg border border-line bg-surface">
        <div className="h-11 border-b border-line" />
        <div className="h-9 border-b border-line bg-surface-2" />
        <TableSkeleton rows={8} widths={["w-28", "w-44", "w-20", "w-72", "w-10"]} />
      </div>
    </div>
  );
}

export default function ReviewLoading() {
  return (
    <>
      <PageHeader title="Review queue" />
      <ReviewSkeleton />
    </>
  );
}
