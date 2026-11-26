"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { ShallowLink } from "@/components/shared/shallow-link";
import { cn } from "@/lib/utils";

export type SlidingTabItem = { key: string; label: string; count?: number; href?: string };

type Props = {
  label: string;
  items: SlidingTabItem[];
  /** Key of the selected item. */
  value: string;
  /** Button mode: called with the chosen key. Items with an `href` are links and need no handler. */
  onValueChange?: (key: string) => void;
  /** Share the full width equally between the tabs instead of sizing each to its text. */
  fill?: boolean;
  className?: string;
};

/**
 * The one tab / filter bar. The active fill is a single element that slides between tabs with
 * `transform` only (translateX plus scaleX, clipped by the rounded container). Its size and place
 * are measured with a ResizeObserver and written straight to the element, so there is no re-render
 * and no layout read per frame. It does not animate on first paint, only on later changes.
 *
 * Tabs with an `href` are shallow links (the URL is the state); others are buttons. Arrow keys,
 * Home and End move focus (roving tabindex); Enter or Space activates. The bar scrolls sideways
 * when it does not fit and keeps the selected tab in view.
 */
export function SlidingTabs({ label, items, value, onValueChange, fill, className }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef(new Map<string, HTMLElement>());
  const selected = items.some((i) => i.key === value) ? value : items[0]?.key;

  const place = useCallback(() => {
    const tab = selected ? tabRefs.current.get(selected) : undefined;
    const indicator = indicatorRef.current;
    if (!tab || !indicator) return;
    indicator.style.transform = `translateX(${tab.offsetLeft}px) scaleX(${tab.offsetWidth})`;
  }, [selected]);

  useLayoutEffect(() => {
    place();
    // Until this runs the selected tab paints its own fill (the `:not([data-ready])` classes), so server HTML is right.
    listRef.current?.setAttribute("data-ready", "true");
  }, [place]);

  // Switch the transition on only after the first position was painted.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (indicatorRef.current) indicatorRef.current.dataset.animate = "true";
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Re-measure when the bar or any tab changes size (counts arriving, window resize, font load).
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(list);
    tabRefs.current.forEach((tab) => observer.observe(tab));
    return () => observer.disconnect();
  }, [place, items.length]);

  // Keep the selected tab inside the scrolled area.
  const firstScroll = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    const tab = selected ? tabRefs.current.get(selected) : undefined;
    if (!list || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    const smooth = !firstScroll.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    firstScroll.current = false;
    if (left < list.scrollLeft) list.scrollTo({ left: Math.max(0, left - 8), behavior: smooth ? "smooth" : "auto" });
    else if (right > list.scrollLeft + list.clientWidth)
      list.scrollTo({ left: right - list.clientWidth + 8, behavior: smooth ? "smooth" : "auto" });
  }, [selected]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    const last = items.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === " " && event.currentTarget instanceof HTMLAnchorElement) {
      event.preventDefault();
      event.currentTarget.click();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    const target = tabRefs.current.get(items[next]?.key ?? "");
    target?.focus();
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={cn(
        "relative flex max-w-full min-w-0 overflow-x-auto rounded-md border border-line-control bg-surface text-table [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        fill && "w-full",
        className,
      )}
    >
      <span
        ref={indicatorRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-0 left-0 h-full w-px origin-left bg-primary-soft will-change-transform",
          "data-[animate=true]:transition-transform data-[animate=true]:duration-200 data-[animate=true]:ease-out motion-reduce:transition-none",
          "[[role=tablist]:not([data-ready])_&]:opacity-0",
        )}
      />
      {items.map((item, i) => {
        const active = item.key === selected;
        const common = {
          role: "tab" as const,
          "aria-selected": active,
          tabIndex: active ? 0 : -1,
          "data-focus-inset": true,
          onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(e, i),
          className: cn(
            "relative z-10 px-2.5 py-1.5 whitespace-nowrap outline-none transition-colors duration-150 motion-reduce:transition-none",
            fill ? "flex-1" : "flex-none",
            i > 0 && "border-l border-line-control",
            active ? "font-semibold text-link" : "font-medium text-ink-2 hover:bg-surface-2",
            active && "[[role=tablist]:not([data-ready])_&]:bg-primary-soft",
          ),
        };
        const ref = (el: HTMLElement | null) => {
          if (el) tabRefs.current.set(item.key, el);
          else tabRefs.current.delete(item.key);
        };
        // The hidden copy in ::after reserves the bold width, so selecting never moves neighbours.
        const text = item.count !== undefined ? `${item.label} ${item.count}` : item.label;
        const content = (
          <span
            data-text={text}
            className="flex flex-col items-center after:invisible after:block after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-text)]"
          >
            <span>
              {item.label}
              {item.count !== undefined && (
                <>
                  {" "}
                  <span className="tabular-nums">{item.count}</span>
                </>
              )}
            </span>
          </span>
        );
        return item.href !== undefined ? (
          <ShallowLink key={item.key} ref={ref} href={item.href} {...common}>
            {content}
          </ShallowLink>
        ) : (
          <button key={item.key} ref={ref} type="button" onClick={() => onValueChange?.(item.key)} {...common}>
            {content}
          </button>
        );
      })}
    </div>
  );
}
