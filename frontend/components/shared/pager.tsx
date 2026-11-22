import { ShallowLink } from "@/components/shared/shallow-link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "1-25 of 128" with Previous and Next. Links, so the page is in the URL and shareable. */
export function Pager({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const last = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
      <span className="text-xs text-ink-2">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Button asChild variant="ghost" size="sm">
            <ShallowLink href={hrefFor(page - 1)}>
              <ChevronLeft aria-hidden="true" /> Previous
            </ShallowLink>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled>
            <ChevronLeft aria-hidden="true" /> Previous
          </Button>
        )}
        {page < last ? (
          <Button asChild variant="ghost" size="sm">
            <ShallowLink href={hrefFor(page + 1)}>
              Next <ChevronRight aria-hidden="true" />
            </ShallowLink>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled>
            Next <ChevronRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </nav>
  );
}
