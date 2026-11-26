import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Same structure as the documents screen: upload zone, filter row, table card. */
export function DocumentsSkeleton() {
  return (
    <div className="flex flex-col gap-section" aria-busy="true">
      <Skeleton className="h-36 sm:h-20 rounded-lg bg-skeleton" />
      <Skeleton className="h-[54px] rounded-lg bg-skeleton" />
      <div className="overflow-clip rounded-lg border border-line bg-surface">
        <div className="h-9 border-b border-line bg-surface-2" />
        <TableSkeleton rows={10} widths={["w-56", "w-24", "w-40", "w-10", "w-10", "w-20"]} />
      </div>
    </div>
  );
}

export default function DocumentsLoading() {
  return (
    <>
      <PageHeader title="Documents" />
      <DocumentsSkeleton />
    </>
  );
}
