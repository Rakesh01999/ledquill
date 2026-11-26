import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** Filter rows, then the table card. */
export function InvoicesSkeleton() {
  return (
    <div className="flex flex-col gap-section" aria-busy="true">
      {/* Same card as the real Toolbar (border, radius, p-3, gap-3). Row 1 is as tall as the tab bar
          (12px padding + 2px border + 1.5 line heights); row 2 is a caption label, 4px gap, 32px control. */}
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-[380px] max-w-full bg-skeleton" />
          <Skeleton className="h-[calc(14px+1.5*var(--text-table))] w-72 max-w-full bg-skeleton" />
        </div>
        <Skeleton className="h-[calc(36px+1.5*var(--text-caption))] w-full max-w-3xl bg-skeleton" />
      </div>
      <div className="h-5" />
      <div className="overflow-clip rounded-lg border border-line bg-surface">
        <div className="h-9 border-b border-line bg-surface-2" />
        <TableSkeleton rows={8} widths={["w-28", "w-44", "w-20", "w-10", "w-20", "w-24", "w-8"]} />
      </div>
    </div>
  );
}

export default function InvoicesLoading() {
  return (
    <>
      <PageHeader title="Invoices" />
      <InvoicesSkeleton />
    </>
  );
}
