"use client";

import { useEffect } from "react";

/**
 * Publishes where a sticky table header must stick: just under the sticky page header, whatever
 * its height (it wraps on a phone). Sets `--table-head-top` on <main>.
 *
 * The page header sticks at `top: -padding` of <main>, so its top edge is <main>'s top edge and
 * its bottom edge is its own height below that. A sticky offset is measured from the content box,
 * hence the padding is subtracted again. Every table reads this one variable.
 */
export function StickyOffset() {
  useEffect(() => {
    const main = document.getElementById("main");
    const header = document.querySelector<HTMLElement>("[data-page-header]");
    if (!main || !header) return;
    const apply = () => {
      const padding = Number.parseFloat(getComputedStyle(main).paddingTop) || 0;
      main.style.setProperty("--table-head-top", `${header.offsetHeight - padding}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    observer.observe(main);
    return () => {
      observer.disconnect();
      main.style.removeProperty("--table-head-top");
    };
  }, []);
  return null;
}
