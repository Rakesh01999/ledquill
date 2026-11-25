"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { currentUrl, rememberList, saveScroll, savedScroll, takeRestoreIntent } from "@/lib/list-state";

/** Keep trying for this long: rows arrive from the network, so the page may not be tall enough yet. */
const RESTORE_FRAMES = 120;

/** Scroll <main> to `top`, retrying until the content is tall enough; any user input stops it. */
function restoreScroll(main: HTMLElement, top: number): void {
  if (top <= 0) {
    main.scrollTop = 0;
    return;
  }
  let frames = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) main.removeEventListener(type, stop);
  };
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    main.addEventListener(type, stop, { once: true, passive: true });
  }
  const tick = () => {
    if (stopped) return;
    main.scrollTop = top;
    if (Math.abs(main.scrollTop - top) < 2 || ++frames > RESTORE_FRAMES) {
      stop();
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
}

const param = (search: string, name: string) => new URLSearchParams(search).get(name);

/**
 * Back and Forward return to the same place: the URL already carries page, size, filters and
 * search, and this restores the scroll position of <main> (the app's scroll container, which the
 * browser does not restore on its own). A new navigation starts at the top; a change of page or
 * size within a list also scrolls back to the top of the new rows.
 */
export function ScrollRestore() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const previous = useRef({ pathname, search });
  const popTarget = useRef<number | null>(null);
  const popped = useRef(false);

  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => saveScroll(currentUrl(), main.scrollTop));
    };
    // The target is read now: later scroll events (the old page shrinking) must not overwrite it.
    const onPop = () => {
      popTarget.current = savedScroll(currentUrl());
      popped.current = true;
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      cancelAnimationFrame(frame);
      main.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    rememberList(currentUrl());
    const main = document.getElementById("main");
    const before = previous.current;
    previous.current = { pathname, search };
    if (!main || (before.pathname === pathname && before.search === search)) return;

    if (popped.current) {
      popped.current = false;
      restoreScroll(main, popTarget.current ?? 0);
    } else if (takeRestoreIntent(currentUrl())) {
      restoreScroll(main, savedScroll(currentUrl()) ?? 0);
    } else if (
      before.pathname !== pathname ||
      param(before.search, "page") !== param(search, "page") ||
      param(before.search, "size") !== param(search, "size")
    ) {
      main.scrollTop = 0;
    }
  }, [pathname, search]);

  return null;
}
