"use client";

import { SlidingTabs } from "@/components/shared/sliding-tabs";

export type Segment = { key: string; label: string; count?: number; href: string; active: boolean };

/**
 * A row of filter links that only change the URL, drawn by the shared SlidingTabs (sliding fill,
 * arrow keys, sideways scroll on narrow screens). Kept as the link-mode adapter so call sites pass
 * plain segments with an `active` flag.
 */
export function SegmentedFilter({ label, segments }: { label: string; segments: Segment[] }) {
  const active = segments.find((s) => s.active) ?? segments[0];
  return (
    <SlidingTabs
      label={label}
      items={segments.map(({ key, label: text, count, href }) => ({ key, label: text, count, href }))}
      value={active?.key ?? ""}
    />
  );
}
