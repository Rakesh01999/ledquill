import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { DOC_ROW } from "@/lib/documents";

/** Same structure as the documents screen: upload zone, filter row, table card. */
export default function DocumentsLoading() {
  return (
    <div className="flex h-full min-h-[560px] flex-col gap-5" aria-busy="true">
      <Skeleton className="h-[86px] rounded-lg bg-skeleton" />
      <div className="flex h-[30px] items-center gap-3">
        <Skeleton className="h-4 w-16 bg-skeleton" />
        <Skeleton className="h-[30px] w-72 bg-skeleton" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div className="h-9 border-b border-line bg-surface-2" />
        <TableSkeleton rows={8} rowClass={DOC_ROW} widths={["w-56", "w-24", "w-40", "w-10", "w-10", "w-20"]} />
      </div>
    </div>
  );
}
