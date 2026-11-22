import type { Metadata } from "next";
import { Suspense } from "react";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { InvoicesView } from "@/components/invoices/invoices-view";
import { isSearchOnly, parseInvoiceParams } from "@/lib/invoices";
import { invoicesOptions, searchOptions } from "@/lib/query/options";
import { getQueryClient, prefetch } from "@/lib/query/server";
import InvoicesLoading from "./loading";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The same query the browser will run for these URL parameters, so the table is in the first paint.
  const params = parseInvoiceParams(await searchParams);
  if (isSearchOnly(params)) await prefetch((c) => searchOptions(c, params.q ?? ""));
  else await prefetch((c) => invoicesOptions(c, params));
  return (
    <HydrationBoundary state={dehydrate(getQueryClient())}>
      <Suspense fallback={<InvoicesLoading />}>
        <InvoicesView />
      </Suspense>
    </HydrationBoundary>
  );
}
