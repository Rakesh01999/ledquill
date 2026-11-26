"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SlidingTabs } from "@/components/shared/sliding-tabs";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { api, unwrap } from "@/lib/api/client";
import type { PageOut } from "@/lib/api/types";
import { pagesOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";
import { ImageViewer, OpenLargeButton, ZoomToolbar, clampZoom } from "./image-viewer";

const METHOD_LABEL: Record<string, string> = { text: "Text layer", ocr: "OCR", sheet: "Sheet" };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Page image fetched through the proxy (the API key is added server-side) as a blob, then held
 * as a data URL so it can sit in the query cache without object URLs to revoke. A plain
 * <img src="/api/..."> would also work through the proxy, but a fetch lets errors show properly.
 */
function PageImage({
  documentId,
  page,
  label,
  extra,
  className,
  viewportClassName,
}: {
  documentId: string;
  page: number;
  label: string;
  extra?: ReactNode;
  className?: string;
  viewportClassName: string;
}) {
  const query = useQuery({
    queryKey: ["page-image", documentId, page],
    queryFn: async () => {
      const blob = await unwrap(
        api.GET("/api/v1/documents/{document_id}/pages/{page_no}/image", {
          params: { path: { document_id: documentId, page_no: page } },
          parseAs: "blob",
        }),
      );
      return blobToDataUrl(blob as Blob);
    },
    staleTime: 5 * 60_000,
    gcTime: 2 * 60_000,
  });

  if (query.isPending) {
    return (
      <div className={cn("flex items-start justify-center rounded-md border border-line bg-surface-2 p-3", viewportClassName)}>
        <Skeleton className="aspect-[1/1.414] w-full max-w-[520px] bg-skeleton" role="status" aria-label="Loading page image" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className={cn("rounded-md border border-line bg-surface-2", viewportClassName)}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  // key: a new page starts at fit-to-width, not at the previous page's zoom.
  return (
    <ImageViewer
      key={`${documentId}-${page}`}
      src={query.data}
      alt={label}
      extra={extra}
      className={className}
      viewportClassName={viewportClassName}
    />
  );
}

/** Extracted text (also the preview of a spreadsheet). Zoom scales the type; the box scrolls inside itself. */
function PageText({
  page,
  isSheet,
  extra,
  className,
  viewportClassName,
}: {
  page: PageOut;
  isSheet: boolean;
  extra?: ReactNode;
  className?: string;
  viewportClassName: string;
}) {
  const text = page.text?.trim();
  const [zoom, setZoom] = useState(1);
  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {text && <ZoomToolbar zoom={zoom} onZoom={(z) => setZoom(clampZoom(z))} extra={extra} />}
      <div className={cn("overflow-auto overscroll-contain rounded-md border border-line bg-surface-2", viewportClassName)}>
        {text ? (
          <pre
            tabIndex={0}
            aria-label={isSheet ? "Extracted sheet text" : "Extracted page text"}
            style={{ fontSize: 12 * zoom }}
            className="w-max min-w-full p-3 font-mono leading-relaxed whitespace-pre-wrap text-ink"
          >
            {text}
          </pre>
        ) : (
          <EmptyState title="No text was found on this page." />
        )}
      </div>
    </div>
  );
}

/**
 * Page text and image of a document. `pageNumbers` limits it to the pages an invoice was found
 * on. `page` and `onPageChange` make the page controlled, so a field's page chip can switch it.
 *
 * `layout="side-by-side"` shows image and text next to each other (the Document page, full width).
 * `layout="toggle"` shows one at a time at the full column width, with an Image / Text switch (the
 * invoice review page, where the column is only half the screen).
 */
export function SourcePanel({
  documentId,
  filename,
  pageNumbers,
  page: controlledPage,
  onPageChange,
  layout = "side-by-side",
  large = false,
}: {
  documentId: string;
  filename: string;
  pageNumbers?: number[] | null;
  page?: number;
  onPageChange?: (pageNo: number) => void;
  layout?: "side-by-side" | "toggle";
  /** Rendered inside the "open large" dialog: fills it, and has no "open large" button of its own. */
  large?: boolean;
}) {
  const { data, isPending, error, refetch } = useQuery(pagesOptions(api, documentId));
  const [ownIndex, setOwnIndex] = useState(0);
  const [view, setView] = useState<"image" | "text">("image");
  const [open, setOpen] = useState(false);

  if (isPending) {
    return <Skeleton className="h-[380px] w-full bg-skeleton" role="status" aria-label="Loading pages" />;
  }
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const pages =
    pageNumbers && pageNumbers.length > 0 ? data.items.filter((p) => pageNumbers.includes(p.page_no)) : data.items;
  if (pages.length === 0) {
    return <EmptyState title="No pages yet. Text appears here once the file has been read." />;
  }

  const total = pages.length;
  const controlledIndex = controlledPage === undefined ? -1 : pages.findIndex((p) => p.page_no === controlledPage);
  const current = Math.min(controlledIndex >= 0 ? controlledIndex : ownIndex, total - 1);
  const setIndex = (i: number) => {
    setOwnIndex(i);
    const target = pages[i];
    if (target) onPageChange?.(target.page_no);
  };
  const page = pages[current];
  if (!page) return null;
  const isSheet = page.method === "sheet";
  const noun = isSheet ? "Sheet" : "Page";
  const toggle = layout === "toggle";
  const showImage = page.has_image && (!toggle || view === "image");
  const showText = !toggle || !showImage;

  // The viewer needs a height of its own. Large: it fills the dialog. Invoice view (toggle) on
  // desktop: it fills the sticky panel. Everywhere else: a viewport-relative height with a floor.
  const fill = large || toggle;
  const viewportClass = large
    ? "min-h-[240px] flex-1"
    : toggle
      ? "h-[65dvh] min-h-[360px] lg:h-auto lg:min-h-[300px] lg:flex-1"
      : "h-[70dvh] min-h-[420px]";
  const bodyClass = fill ? "min-h-0 flex-1" : undefined;
  const largeButton = large ? undefined : <OpenLargeButton onClick={() => setOpen(true)} />;

  return (
    <div className={cn("flex flex-col gap-3", fill && "min-h-0 lg:h-full", large && "h-full")}>
      {isSheet && total > 1 && (
        // One tab per sheet. The API gives the sheet's position, not its name, so the tabs say "Sheet 2".
        <SlidingTabs
          label="Sheets"
          items={pages.map((p) => ({ key: String(p.page_no), label: `Sheet ${p.page_no}` }))}
          value={String(pages[current]?.page_no ?? "")}
          onValueChange={(key) => setIndex(pages.findIndex((p) => String(p.page_no) === key))}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Previous ${noun.toLowerCase()}`}
          disabled={current === 0}
          onClick={() => setIndex(current - 1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <span className="min-w-24 text-center text-table tabular-nums" aria-live="polite">
          {noun} {current + 1} / {total}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Next ${noun.toLowerCase()}`}
          disabled={current === total - 1}
          onClick={() => setIndex(current + 1)}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
        <span className="text-xs whitespace-nowrap text-ink-3">{METHOD_LABEL[page.method] ?? page.method}</span>
        {toggle && page.has_image && (
          <div role="group" aria-label="Source view" className="ml-auto flex flex-none overflow-hidden rounded-md border border-line text-xs">
            {(["image", "text"] as const).map((v, i) => (
              <button
                key={v}
                type="button"
                data-focus-inset
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "px-2.5 py-1 outline-none hover:bg-surface-2",
                  i > 0 && "border-l border-line",
                  view === v ? "bg-primary-soft font-semibold text-link" : "text-ink-2",
                )}
              >
                {v === "image" ? "Image" : "Text"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={cn(page.has_image && !toggle ? "grid gap-4 lg:grid-cols-2" : "flex flex-col", bodyClass)}>
        {showImage && (
          <PageImage
            documentId={documentId}
            page={page.page_no}
            label={`${filename}, page ${page.page_no}`}
            extra={largeButton}
            className={fill ? "min-h-0 flex-1" : undefined}
            viewportClassName={viewportClass}
          />
        )}
        {showText && (
          <PageText
            page={page}
            isSheet={isSheet}
            // With an image beside it the image toolbar already carries the button.
            extra={showImage ? undefined : largeButton}
            className={fill ? "min-h-0 flex-1" : undefined}
            viewportClassName={viewportClass}
          />
        )}
      </div>
      {!large && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex h-[94dvh] w-[96vw] max-w-[96vw] flex-col gap-3 p-4 sm:max-w-[96vw]">
            <DialogTitle className="pr-8 text-sm break-all">{filename}</DialogTitle>
            <DialogDescription className="sr-only">
              Large preview. Ctrl and mouse wheel zoom, drag to move, Escape closes.
            </DialogDescription>
            <div className="min-h-0 flex-1">
              <SourcePanel
                documentId={documentId}
                filename={filename}
                pageNumbers={pageNumbers}
                page={page.page_no}
                onPageChange={(n) => {
                  setOwnIndex(Math.max(0, pages.findIndex((p) => p.page_no === n)));
                  onPageChange?.(n);
                }}
                layout={toggle ? "toggle" : "side-by-side"}
                large
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
