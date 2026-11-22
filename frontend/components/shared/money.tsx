import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDecimal } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Missing value: a dash, explained on hover and to screen readers. Never a zero. */
export function Missing({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("cursor-default text-ink-3", className)}>
          <span aria-hidden="true">—</span>
          <span className="sr-only">Not found in document</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Not found in document</TooltipContent>
    </Tooltip>
  );
}

/**
 * A money amount from a decimal string, right-aligned with tabular figures. The currency code
 * belongs in the column header, not on every cell. The string is only grouped and padded.
 */
export function Money({ value, className }: { value: string | null | undefined; className?: string }) {
  const text = formatDecimal(value);
  return (
    <span className={cn("inline-block text-right tabular-nums", className)}>
      {text ?? <Missing />}
    </span>
  );
}
