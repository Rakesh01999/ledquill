import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentsView } from "@/components/documents/documents-view";
import { parseListParams } from "@/lib/documents";
import { documentsOptions } from "@/lib/query/options";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getQueryClient, prefetch } from "@/lib/query/server";
import { PageHeader } from "@/components/shared/page-header";
import { UploadButton } from "@/components/documents/upload-section";
import { DocumentsSkeleton } from "./loading";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The first page of rows is fetched here and handed to the browser, so the table is in the
  // first paint. Filters afterwards change the URL only and are fetched in the browser.
  const params = parseListParams(await searchParams);
  await prefetch((client) => documentsOptions(client, params));
  return (
    <>
      <PageHeader title="Documents" actions={<UploadButton />} />
      <HydrationBoundary state={dehydrate(getQueryClient())}>
        <Suspense fallback={<DocumentsSkeleton />}>
          <DocumentsView />
        </Suspense>
      </HydrationBoundary>
    </>
  );
}
