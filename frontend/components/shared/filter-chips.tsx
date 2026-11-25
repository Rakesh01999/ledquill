import { X } from "lucide-react";
import { ShallowLink } from "@/components/shared/shallow-link";

export type Chip = { key: string; label: string; /** URL without this filter. */ href: string };

/** Active filters as removable chips, plus "Clear all". Every control is a link that edits the URL. */
export function FilterChips({ chips, clearHref }: { chips: Chip[]; clearHref: string }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <span className="text-xs text-ink-2" id="active-filters-label">
        Active filters
      </span>
      <ul aria-labelledby="active-filters-label" className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <li
            key={chip.key}
            className="inline-flex max-w-full items-center rounded-md border border-line-strong bg-surface-2 pl-2 text-xs text-ink"
          >
            <span className="truncate py-1">{chip.label}</span>
            <ShallowLink
              href={chip.href}
              aria-label={`Remove filter: ${chip.label}`}
              className="ml-0.5 inline-flex size-6 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-line hover:text-ink"
            >
              <X className="size-3" aria-hidden="true" />
            </ShallowLink>
          </li>
        ))}
      </ul>
      <ShallowLink href={clearHref} className="rounded-sm px-1 py-1 text-xs font-medium text-link hover:underline">
        Clear all
      </ShallowLink>
    </div>
  );
}
