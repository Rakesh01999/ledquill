"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";

const HOVER_DELAY_MS = 150;

/**
 * Props for a row that warms the cache once the mouse has rested on it for ~150 ms. Touch and
 * pen pointers never prefetch (no hover there, and a swipe across rows would fetch them all).
 */
export function useHoverPrefetch() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel]);
  return useCallback(
    (prefetch: () => void) => ({
      onPointerEnter: (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        clearTimeout(timer.current);
        timer.current = setTimeout(prefetch, HOVER_DELAY_MS);
      },
      onPointerLeave: cancel,
    }),
    [cancel],
  );
}
