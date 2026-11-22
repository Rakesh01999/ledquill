import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Filter rows, then the table card. */
export default function InvoicesLoading() {
  return (
    <div className="flex h-full min-h-[560px] flex-col gap-4" aria-busy="true">
      <div className="flex flex-col gap-3">
        <div className="flex h-8 items-center gap-3">
          <Skeleton className="h-8 w-[380px] max-w-full bg-skeleton" />
          <Skeleton className="h-[30px] w-72 bg-skeleton" />
        </div>
        <Skeleton className="h-[52px] w-full max-w-3xl bg-skeleton" />
      </div>
      <div className="h-5" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div className="h-9 border-b border-line bg-surface-2" />
        <TableSkeleton rows={8} widths={["w-28", "w-44", "w-20", "w-10", "w-20", "w-24", "w-8"]} />
      </div>
    </div>
  );
}
