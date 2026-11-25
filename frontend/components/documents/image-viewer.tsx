"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Expand, Maximize2, MoveHorizontal, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;
const STEP = 1.25;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zoom controls shared by the image viewer and the text view (which scales its font instead). */
export function ZoomToolbar({
  zoom,
  onZoom,
  onFitWidth,
  onFitPage,
  onRotate,
  extra,
  className,
}: {
  zoom: number;
  onZoom: (next: number) => void;
  onFitWidth?: () => void;
  onFitPage?: () => void;
  onRotate?: () => void;
  extra?: ReactNode;
  className?: string;
}) {
  const tip = (label: string, button: ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
  return (
    <div role="toolbar" aria-label="Preview controls" className={cn("flex flex-wrap items-center gap-1", className)}>
      {tip(
        "Zoom out (-)",
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => onZoom(clampZoom(zoom / STEP))}
        >
          <ZoomOut aria-hidden="true" />
        </Button>,
      )}
      <span
        aria-live="polite"
        aria-label={`Zoom ${Math.round(zoom * 100)} percent`}
        className="min-w-12 text-center text-xs tabular-nums text-ink-2"
      >
        {Math.round(zoom * 100)}%
      </span>
      {tip(
        "Zoom in (+)",
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => onZoom(clampZoom(zoom * STEP))}
        >
          <ZoomIn aria-hidden="true" />
        </Button>,
      )}
      {onFitWidth &&
        tip(
          "Fit to width",
          <Button variant="outline" size="icon-sm" aria-label="Fit to width" onClick={onFitWidth}>
            <MoveHorizontal aria-hidden="true" />
          </Button>,
        )}
      {onFitPage &&
        tip(
          "Fit to page",
          <Button variant="outline" size="icon-sm" aria-label="Fit to page" onClick={onFitPage}>
            <Maximize2 aria-hidden="true" />
          </Button>,
        )}
      {tip(
        "Reset to 100% (0)",
        <Button variant="outline" size="xs" aria-label="Reset zoom to 100 percent" onClick={() => onZoom(1)}>
          100%
        </Button>,
      )}
      {onRotate &&
        tip(
          "Rotate 90 degrees (R)",
          <Button variant="outline" size="icon-sm" aria-label="Rotate" onClick={onRotate}>
            <RotateCw aria-hidden="true" />
          </Button>,
        )}
      {extra}
    </div>
  );
}

/** The "open large" control: icon button with a tooltip, used next to the zoom controls. */
export function OpenLargeButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Open large" onClick={onClick}>
          <Expand aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Open large</TooltipContent>
    </Tooltip>
  );
}

type Size = { w: number; h: number };

/**
 * A page image you can zoom, pan and rotate. 100% means "fit to width"; fit to page is a zoom
 * below that on a tall page. The viewport scrolls inside itself (overflow auto, overscroll
 * contained), so the page and <main> never grow or scroll because of it.
 *
 * Ctrl+wheel and trackpad pinch zoom at the pointer; two-finger pinch zooms on touch; dragging
 * pans with the mouse (touch uses native scrolling); + - 0 R work while the viewport has focus.
 */
export function ImageViewer({
  src,
  alt,
  extra,
  className,
  viewportClassName,
}: {
  src: string;
  alt: string;
  /** Extra toolbar controls, e.g. the "open large" button. */
  extra?: ReactNode;
  className?: string;
  /** Height of the viewport; it needs one, the default suits a standalone viewer. */
  viewportClassName?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoomState] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Where the content point under the anchor sat before a zoom, so the same point stays under it.
  const anchor = useRef<{ fx: number; fy: number; ax: number; ay: number } | null>(null);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const turned = rotation % 180 !== 0;
  const nw = natural ? (turned ? natural.h : natural.w) : 1;
  const nh = natural ? (turned ? natural.w : natural.h) : 1;
  // Padding inside the viewport (p-3 = 12px each side).
  const PAD = 24;
  const fitWidthScale = box.w > PAD ? (box.w - PAD) / nw : 1;
  const shownW = nw * fitWidthScale * zoom;
  const shownH = nh * fitWidthScale * zoom;

  const setZoom = useCallback((next: number, at?: { x: number; y: number }) => {
    const el = viewport.current;
    if (el) {
      const ax = at?.x ?? el.clientWidth / 2;
      const ay = at?.y ?? el.clientHeight / 2;
      const contentW = el.scrollWidth || 1;
      const contentH = el.scrollHeight || 1;
      anchor.current = { fx: (el.scrollLeft + ax) / contentW, fy: (el.scrollTop + ay) / contentH, ax, ay };
    }
    setZoomState(clampZoom(next));
  }, []);

  // After the new size is laid out, put the anchored point back under the pointer.
  useLayoutEffect(() => {
    zoomRef.current = zoom;
    const el = viewport.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = a.fx * el.scrollWidth - a.ax;
    el.scrollTop = a.fy * el.scrollHeight - a.ay;
  }, [zoom]);

  const fitWidth = () => {
    setZoomState(1);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  };
  const fitPage = () => {
    if (!natural || box.w <= PAD || box.h <= PAD) return;
    const page = Math.min((box.w - PAD) / nw, (box.h - PAD) / nh);
    setZoomState(clampZoom(page / fitWidthScale));
    viewport.current?.scrollTo({ left: 0, top: 0 });
  };
  const rotate = () => {
    setRotation((r) => (r + 90) % 360);
    setZoomState(1);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  };

  // Ctrl+wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms at the pointer. It needs a
  // non-passive native listener: React's onWheel cannot stop the browser zooming the whole page.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      setZoom(zoomRef.current * Math.exp(-event.deltaY * 0.0025), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  // Pointers: one mouse pointer drags to pan; two touch pointers pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; zoom: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoomRef.current };
    } else if (event.pointerType === "mouse" && event.button === 0) {
      viewport.current?.setPointerCapture(event.pointerId);
      setDragging(true);
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const el = viewport.current;
    if (!el) return;
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const rect = el.getBoundingClientRect();
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom(gesture.current.zoom * (distance / gesture.current.distance), {
        x: (a.x + b.x) / 2 - rect.left,
        y: (a.y + b.y) / 2 - rect.top,
      });
    } else if (dragging) {
      el.scrollLeft -= event.clientX - previous.x;
      el.scrollTop -= event.clientY - previous.y;
    }
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") setZoom(zoom * STEP);
    else if (event.key === "-" || event.key === "_") setZoom(zoom / STEP);
    else if (event.key === "0") fitWidth();
    else if (event.key === "r" || event.key === "R") rotate();
    else return;
    event.preventDefault();
  };

  const canPan = shownW > box.w - PAD / 2 || shownH > box.h - PAD / 2;

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <ZoomToolbar
        zoom={zoom}
        onZoom={(z) => (z === 1 ? fitWidth() : setZoom(z))}
        onFitWidth={fitWidth}
        onFitPage={fitPage}
        onRotate={rotate}
        extra={extra}
      />
      <div
        ref={viewport}
        tabIndex={0}
        role="group"
        aria-label={`${alt}. Zoom with plus and minus, drag to move, R to rotate`}
        data-testid="image-viewport"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className={cn(
          "relative min-h-0 overflow-auto overscroll-contain rounded-md border border-line bg-surface-2 p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary",
          "[touch-action:pan-x_pan-y]",
          canPan && (dragging ? "cursor-grabbing select-none" : "cursor-grab"),
          viewportClassName ?? "h-[420px]",
        )}
      >
        {/* The wrapper takes the rotated size, so the scrollable area matches what is drawn. */}
        <div className="relative mx-auto" style={{ width: shownW, height: shownH }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the authenticated proxy; next/image cannot optimise it */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className={cn("absolute top-1/2 left-1/2 max-w-none bg-white shadow-sm select-none", !natural && "invisible")}
            style={{
              width: turned ? shownH : shownW,
              height: turned ? shownW : shownH,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
