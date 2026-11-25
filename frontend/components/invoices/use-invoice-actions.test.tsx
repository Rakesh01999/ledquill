import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceOut } from "@/lib/api/types";
import { invoiceOptions } from "@/lib/query/options";
import { makeInvoice } from "@/test/fixtures";
import { CorrectionsPanel } from "./corrections-panel";
import { useCorrectInvoice } from "./use-invoice-actions";

const ID = "11111111-1111-1111-1111-111111111111";
const store = vi.hoisted(() => ({ current: null as InvoiceOut | null, patch: vi.fn() }));

// The API client: GET returns the stored invoice, PATCH applies the edit and records a correction,
// as the real server does. `unwrap` is the real one's contract: the data of a successful call.
vi.mock("@/lib/api/client", () => ({
  api: {
    GET: vi.fn(async () => ({ data: store.current, response: { ok: true, status: 200 } })),
    PATCH: store.patch,
  },
  unwrap: async (call: Promise<{ data?: unknown }>) => (await call).data,
}));

function Harness() {
  const { data } = useQuery(invoiceOptions({ GET: async () => ({ data: store.current }) } as never, ID));
  const correct = useCorrectInvoice(ID);
  if (!data) return null;
  return (
    <>
      <button onClick={() => correct.mutate({ field: "supplier_name", value: "New Supplier Ltd" })}>edit</button>
      <CorrectionsPanel corrections={data.corrections} />
    </>
  );
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("corrections history after an edit", () => {
  beforeEach(() => {
    store.current = makeInvoice({ id: ID });
    store.patch.mockReset();
    store.patch.mockImplementation(async () => {
      const before = store.current!;
      store.current = {
        ...before,
        supplier_name: "New Supplier Ltd",
        corrected_fields: ["supplier_name"],
        corrections: [
          ...before.corrections,
          {
            field: "supplier_name",
            old_value: before.supplier_name,
            new_value: "New Supplier Ltd",
            note: null,
            created_at: `2026-09-02T09:0${before.corrections.length}:00Z`,
          },
        ],
      };
      return { data: store.current, response: { ok: true, status: 200 } };
    });
  });

  it("shows the new entry without a refresh: field, old value to new value", async () => {
    mount();
    expect(await screen.findByText("No corrections yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "edit" }));

    await waitFor(() => expect(screen.queryByText("No corrections yet.")).toBeNull());
    expect(screen.getByText("Supplier")).toBeInTheDocument();
    expect(screen.getByText("Acme Supplies Ltd")).toBeInTheDocument();
    expect(screen.getByText("New Supplier Ltd")).toBeInTheDocument();
    expect(store.patch).toHaveBeenCalledTimes(1);
  });

  it("keeps earlier entries and adds the next one", async () => {
    mount();
    await screen.findByText("No corrections yet.");
    await userEvent.click(screen.getByRole("button", { name: "edit" }));
    await screen.findByText("New Supplier Ltd");
    await userEvent.click(screen.getByRole("button", { name: "edit" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
  });
});
