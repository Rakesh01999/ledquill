import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Same structure as the archived screen: tab row, table card with its top bar. */
export function ArchivedSkeleton() {
  return (
    <div className="flex flex-col gap-section" aria-busy="true">
      <Skeleton className="h-[54px] rounded-lg bg-skeleton" />
      <div className="overflow-clip rounded-lg border border-line bg-surface">
        <div className="h-11 border-b border-line" />
        <div className="h-9 border-b border-line bg-surface-2" />
        <TableSkeleton rows={6} widths={["w-56", "w-24", "w-16", "w-24"]} />
      </div>
    </div>
  );
}

export default function ArchivedLoading() {
  return (
    <>
      <PageHeader title="Archived" />
      <ArchivedSkeleton />
    </>
  );
}
