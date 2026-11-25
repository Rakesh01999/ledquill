import { Skeleton } from "@/components/ui/skeleton";
import { ROW } from "@/lib/table";
import { cn } from "@/lib/utils";

/**
 * Skeleton rows with the same height as the real rows, so content replaces them with no layout
 * shift. `widths` shapes each column like its final content.
 */
export function TableSkeleton({
  rows = 8,
  widths = ["w-48", "w-20", "w-24", "w-12", "w-16"],
  rowClass = ROW,
}: {
  rows?: number;
  widths?: string[];
  rowClass?: string;
}) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={cn("flex items-center gap-6 px-4", rowClass)}>
          {widths.map((w, c) => (
            <Skeleton key={c} className={cn("h-3.5 bg-skeleton", w, c === 0 && "max-w-64 flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}
