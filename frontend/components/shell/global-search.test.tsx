import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { GlobalSearchData } from "@/lib/global-search";
import { GlobalSearch } from "./global-search";

const mocks = vi.hoisted(() => ({ push: vi.fn(), get: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/api/client", () => ({
  api: { GET: mocks.get },
  unwrap: async (call: Promise<{ data?: unknown; error?: unknown }>) => {
    const { data, error } = await call;
    if (error) throw new Error("boom");
    return data;
  },
}));

const none = { items: [], more: false };
const result = (patch: Partial<GlobalSearchData>): GlobalSearchData => ({
  q: "",
  documents: none,
  invoices: none,
  suppliers: none,
  archived: none,
  ...patch,
});
const invoice = (id: string, number: string, supplier: string) => ({
  id,
  document_id: "d1",
  invoice_number: number,
  supplier_name: supplier,
  total: "2970.00",
  currency: "USD",
  invoice_date: "2026-09-01",
  status: "ready",
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <button>before</button>
        <input aria-label="some field" />
        <GlobalSearch />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const searchBox = () => screen.findByRole("combobox", { name: /search invoices/i });

beforeEach(() => {
  mocks.push.mockReset();
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (_path: string, init: { params: { query: { q: string } } }) => {
    const q = init.params.query.q;
    if (q === "none") return { data: result({ q }), response: { ok: true } };
    return {
      data: result({
        q,
        invoices: { items: [invoice("i1", "INV-2970", "Acme Supplies Ltd"), invoice("i2", "INV-2971", "Globex")], more: false },
        suppliers: { items: [{ supplier: "Acme Supplies Ltd", count: 2 }], more: false },
        archived: {
          items: [{ kind: "invoice", id: "a1", document_id: "d9", title: "OLD-1", detail: "Acme", archived_at: "2026-11-01T00:00:00Z" }],
          more: false,
        },
      }),
      response: { ok: true },
    };
  });
});

describe("opening and closing", () => {
  it("opens from the button, and Escape closes it and returns focus to the button", async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getAllByRole("button", { name: /search/i })[0]!;
    await user.click(trigger);
    expect(await searchBox()).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("opens with Ctrl+K even from inside a field, and returns focus to that field", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByLabelText("some field"));
    await user.keyboard("{Control>}k{/Control}");
    expect(await searchBox()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByLabelText("some field")).toHaveFocus());
  });

  it('opens with "/" only when no field has focus', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByLabelText("some field"));
    await user.keyboard("/");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByLabelText("some field")).toHaveValue("/");
    await user.click(screen.getByRole("button", { name: "before" }));
    await user.keyboard("/");
    expect(await searchBox()).toBeInTheDocument();
  });
});

describe("searching", () => {
  it("asks for two characters, searches once after the pause, with the typed text", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    const box = await searchBox();
    expect(screen.getByText(/Type an invoice number/)).toBeInTheDocument();
    await user.type(box, "a");
    expect(screen.getByText("Type at least 2 characters.")).toBeInTheDocument();
    await user.type(box, "cme");
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(mocks.get.mock.calls[0]?.[1].params.query).toEqual({ q: "acme", limit: 5 });
  });

  it("shows results in marked groups with the match highlighted and Archived labelled", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "acme");
    const list = await screen.findByRole("listbox", { name: "Search results" });
    await within(list).findByText("Suppliers");
    expect(within(list).getByRole("group", { name: "Invoices" })).toBeInTheDocument();
    const archived = within(list).getByRole("group", { name: /Archived/ });
    expect(within(archived).getByText("OLD-1")).toBeInTheDocument();
    expect(within(archived).getAllByText("Archived").length).toBeGreaterThan(0);
    expect(list.querySelectorAll("mark").length).toBeGreaterThan(0);
    expect(within(list).getByRole("option", { name: /See all invoice results for/ })).toBeInTheDocument();
  });

  it("never renders what the user typed as markup", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "<img src=x onerror=alert(1)>");
    await screen.findByRole("listbox");
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByRole("option", { name: /See all invoice results/ }).textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("moves with the arrow keys and opens the chosen row with Enter", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    const box = await searchBox();
    await user.type(box, "inv");
    await screen.findByRole("option", { name: /INV\s*-?\s*2970/ });
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0]?.id);
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(mocks.push).toHaveBeenCalledWith("/invoices/i2");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });

  it("opens an archived invoice, a supplier and 'see all' with the right URLs", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "acme");
    await user.click(await screen.findByRole("option", { name: /OLD-1/ }));
    expect(mocks.push).toHaveBeenLastCalledWith("/invoices/a1");
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "acme");
    await user.click(await screen.findByRole("option", { name: /Acme Supplies Ltd.*2 invoices/ }));
    expect(mocks.push).toHaveBeenLastCalledWith("/invoices?supplier=Acme+Supplies+Ltd&size=25".replace("&size=25", ""));
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "acme ltd");
    await user.click(await screen.findByRole("option", { name: /See all invoice results/ }));
    expect(mocks.push).toHaveBeenLastCalledWith("/invoices?q=acme+ltd");
  });

  it("says so when nothing matches, and Enter still offers the full list", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "none");
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(mocks.push).toHaveBeenCalledWith("/invoices?q=none");
  });

  it("shows an error with a retry", async () => {
    mocks.get.mockImplementation(async () => ({ error: { title: "x" }, response: { ok: false } }));
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "acme");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
