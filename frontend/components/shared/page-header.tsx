import { CrumbLink } from "@/components/shared/crumb-link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

/**
 * Sticky top section of a page: breadcrumb, title and the page's actions. It bleeds over the
 * padding of <main> (the scroll container), so it stays put while the page scrolls under it.
 * Sticky offsets are measured from <main>'s content box, hence the negative top that cancels its
 * padding. Solid background on purpose: nothing shows through.
 */
export function PageHeader({
  crumbs = [],
  title,
  meta,
  actions,
  titleClassName,
}: {
  /** Parents of this page, outermost first, ending with the page itself. Empty on top-level pages. */
  crumbs?: Crumb[];
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <div className="sticky -top-4 z-20 -mx-4 -mt-4 mb-4 border-b border-line bg-canvas px-4 py-2.5 md:-top-6 md:-mx-6 md:-mt-6 md:mb-6 md:px-6">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-1">
        {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex min-w-0 items-center gap-1 text-xs text-ink-2">
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={`${i}-${crumb.label}`} className={cn("flex min-w-0 items-center gap-1", last && "text-ink-3")}>
                  {crumb.href && !last ? (
                    <CrumbLink href={crumb.href} className="rounded-sm hover:text-link hover:underline">
                      {crumb.label}
                    </CrumbLink>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className="truncate">
                      {crumb.label}
                    </span>
                  )}
                  {!last && <ChevronRight className="size-3 flex-none text-ink-3" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </nav>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className={cn("min-w-0 truncate text-xl leading-8 font-semibold", titleClassName)}>{title}</h1>
            {meta}
          </div>
          {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
