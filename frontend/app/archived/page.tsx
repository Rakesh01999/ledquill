import type { Metadata } from "next";
import { Suspense } from "react";
import { ArchivedView } from "@/components/archived/archived-view";
import { PageHeader } from "@/components/shared/page-header";
import { ArchivedSkeleton } from "./loading";

export const metadata: Metadata = { title: "Archived" };

export default function ArchivedPage() {
  return (
    <>
      <PageHeader title="Archived" />
      <Suspense fallback={<ArchivedSkeleton />}>
        <ArchivedView />
      </Suspense>
    </>
  );
}
