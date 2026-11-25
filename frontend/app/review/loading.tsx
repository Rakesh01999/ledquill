import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

export default function ReviewLoading() {
  return (
    <>
    <PageHeader title="Review queue" />
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="flex h-5 items-center gap-3">
        <Skeleton className="h-4 w-24 bg-skeleton" />
        <Skeleton className="h-4 w-72 bg-skeleton" />
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="h-9 border-b border-line bg-surface-2" />
        <TableSkeleton rows={8} widths={["w-28", "w-44", "w-20", "w-72", "w-10"]} />
      </div>
    </div>
    </>
  );
}
