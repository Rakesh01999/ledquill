import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsView } from "./documents-view";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/documents",
}));
// The real `unwrap` stays, so a non-2xx response becomes the same ApiProblem the app throws.
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: { GET: mocks.get },
}));
vi.mock("./upload-section", () => ({ UploadSection: () => null }));

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200, headers: new Headers() } });
const emptyStats = {
  documents: { total: 0, by_status: { queued: 0, processing: 0, completed: 0, failed: 0 } },
  invoices: { total: 0, by_status: { needs_review: 0, ready: 0, approved: 0 } },
  needs_review: 0,
  success_rate: null,
  failure_rate: null,
  avg_processing_seconds: null,
  avg_stage_ms: {},
};

/** /stats always answers; only the documents list changes between tests. */
function serve(documents: unknown) {
  mocks.get.mockImplementation(async (path?: string) => (path?.endsWith("/stats") ? ok(emptyStats) : documents));
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DocumentsView />
    </QueryClientProvider>,
  );
}

describe("DocumentsView", () => {
  beforeEach(() => mocks.get.mockReset());

  it("shows the empty state, not an error, when there are no documents", async () => {
    serve(ok({ items: [], total: 0, limit: 25, offset: 0 }));
    mount();
    expect(await screen.findByText("No documents yet. Upload your first invoice.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a real server error as an error, with a retry and the reference id", async () => {
    serve({
      error: { title: "Internal Server Error", status: 500, detail: "Internal server error", request_id: "a1b2c3d4e5f6" },
      response: { ok: false, status: 500, headers: new Headers() },
    });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on the server");
    expect(screen.getByText("a1b2c3d4e5f6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/No documents yet/)).not.toBeInTheDocument();
  });
});
