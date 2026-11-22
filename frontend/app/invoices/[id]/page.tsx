import type { Metadata } from "next";
import { Suspense } from "react";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { InvoiceDetail, InvoiceDetailSkeleton } from "@/components/invoices/invoice-detail";
import type { InvoiceOut } from "@/lib/api/types";
import { documentOptions, invoiceOptions, pagesOptions } from "@/lib/query/options";
import { getQueryClient, prefetch } from "@/lib/query/server";

export const metadata: Metadata = { title: "Invoice review" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prefetch((c) => invoiceOptions(c, id));
  // The source panel needs the invoice's document; fetch it and its pages once the id is known.
  const invoice = getQueryClient().getQueryData<InvoiceOut>(["invoices", "detail", id]);
  if (invoice) {
    await Promise.all([
      prefetch((c) => documentOptions(c, invoice.document_id)),
      prefetch((c) => pagesOptions(c, invoice.document_id)),
    ]);
  }
  return (
    <HydrationBoundary state={dehydrate(getQueryClient())}>
      <Suspense fallback={<InvoiceDetailSkeleton />}>
        <InvoiceDetail id={id} />
      </Suspense>
    </HydrationBoundary>
  );
}
