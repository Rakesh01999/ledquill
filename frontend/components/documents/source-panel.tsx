"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { api, unwrap } from "@/lib/api/client";
import type { PageOut } from "@/lib/api/types";
import { pagesOptions } from "@/lib/query/options";
import { cn } from "@/lib/utils";

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
function PageImage({ documentId, page, label, wide }: { documentId: string; page: number; label: string; wide: boolean }) {
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

  // Reserve an A4 portrait box so the page does not jump when the image arrives.
  return (
    <div className="flex min-h-[320px] items-start justify-center rounded-md border border-line bg-surface-2 p-3">
      {query.isPending ? (
        <Skeleton
          className={cn("aspect-[1/1.414] w-full bg-skeleton", !wide && "max-w-[520px]")}
          role="status"
          aria-label="Loading page image"
        />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL from the authenticated proxy; next/image cannot optimise it
        <img src={query.data} alt={label} className={cn("h-auto w-full bg-white shadow-sm", !wide && "max-w-[520px]")} />
      )}
    </div>
  );
}

function PageText({ page, isSheet, fill }: { page: PageOut; isSheet: boolean; fill: boolean }) {
  const text = page.text?.trim();
  return (
    <div className="min-h-[320px] rounded-md border border-line bg-surface-2">
      {text ? (
        <pre
          tabIndex={0}
          aria-label={isSheet ? "Extracted sheet text" : "Extracted page text"}
          className={cn(
            "overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink",
            // In the invoice view the whole panel scrolls, so the text does not scroll inside it.
            !fill && "max-h-[640px]",
          )}
        >
          {text}
        </pre>
      ) : (
        <EmptyState title="No text was found on this page." />
      )}
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
}: {
  documentId: string;
  filename: string;
  pageNumbers?: number[] | null;
  page?: number;
  onPageChange?: (pageNo: number) => void;
  layout?: "side-by-side" | "toggle";
}) {
  const { data, isPending, error, refetch } = useQuery(pagesOptions(api, documentId));
  const [ownIndex, setOwnIndex] = useState(0);
  const [view, setView] = useState<"image" | "text">("image");

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

  return (
    <div className="flex flex-col gap-3">
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
        <span className="min-w-24 text-center text-[13px] tabular-nums" aria-live="polite">
          {noun} {current + 1} of {total}
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
      <div className={page.has_image && !toggle ? "grid gap-4 lg:grid-cols-2" : ""}>
        {showImage && (
          <PageImage
            documentId={documentId}
            page={page.page_no}
            label={`${filename}, page ${page.page_no}`}
            wide={toggle}
          />
        )}
        {(!toggle || !showImage) && <PageText page={page} isSheet={isSheet} fill={toggle} />}
      </div>
    </div>
  );
}
