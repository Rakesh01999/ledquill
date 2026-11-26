"use client";

import type { ComponentProps, MouseEvent } from "react";

/**
 * A link that changes only the URL (filters, page) and leaves the data to the client: Next syncs
 * `useSearchParams` with `history.pushState`, so the list switches query key at once and keeps
 * showing the previous rows until the new ones arrive. No server round trip, no skeleton flash.
 * Modified clicks (new tab) keep their normal behaviour.
 */
export function ShallowLink({ href, onClick, ...props }: ComponentProps<"a"> & { href: string }) {
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    window.history.pushState(null, "", href);
  }
  return <a href={href} onClick={handle} {...props} />;
}
