import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { GlobalSearchData } from "@/lib/global-search";
import { GlobalSearch } from "./global-search";

const mocks = vi.hoisted(() => ({ push: vi.fn(), get: vi.fn(), setTheme: vi.fn(), theme: { resolved: "light" } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: mocks.theme.resolved, setTheme: mocks.setTheme }),
}));
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
  mocks.setTheme.mockReset();
  mocks.theme.resolved = "light";
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
    expect(screen.getByText(/Or search invoices and documents/)).toBeInTheDocument();
    await user.type(box, "a");
    expect(screen.getByText("Type at least 2 characters to search invoices and documents.")).toBeInTheDocument();
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
    expect(await within(list).findByRole("group", { name: "Invoices" })).toBeInTheDocument();
    expect(within(list).queryByText("Suppliers")).toBeNull();
    const archived = within(list).getByRole("group", { name: /Archived/ });
    expect(within(archived).getByText("OLD-1")).toBeInTheDocument();
    expect(within(archived).getAllByText("Archived").length).toBeGreaterThan(0);
    expect(list.querySelectorAll("mark").length).toBeGreaterThan(0);
  });

  it("never renders what the user typed as markup", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "<img src=x onerror=alert(1)>");
    await screen.findByRole("listbox");
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(screen.queryByRole("option", { name: /See all/ })).toBeNull();
  });

  it("moves with the arrow keys and opens the chosen row with Enter", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    const box = await searchBox();
    // Invoice-like text matches no page, so the first option is the first invoice.
    await user.type(box, "INV-297");
    await screen.findByRole("option", { name: /INV-297\s*0/ });
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0]?.id);
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(mocks.push).toHaveBeenCalledWith("/invoices/i2");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });

  it("opens an archived invoice from its row, and offers no supplier or 'see all' row", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "acme");
    expect(await screen.findByRole("option", { name: /INV-2970/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /invoices$/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /See all/ })).toBeNull();
    await user.click(screen.getByRole("option", { name: /OLD-1/ }));
    expect(mocks.push).toHaveBeenLastCalledWith("/invoices/a1");
  });

  it("says so when nothing matches, and Enter goes nowhere (it never writes a page filter)", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "none");
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(mocks.push).not.toHaveBeenCalled();
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

describe("pages and actions", () => {
  it("lists the pages and the theme action as soon as it opens, with no request", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await searchBox();
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual([
      expect.stringContaining("Dashboard"),
      expect.stringContaining("Documents"),
      expect.stringContaining("Review queue"),
      expect.stringContaining("Invoices"),
      expect.stringContaining("Archived"),
      expect.stringContaining("Toggle theme"),
    ]);
    expect(screen.getByRole("group", { name: "Pages and actions" })).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("filters them as you type, before any server result, and still makes no request for one letter", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "r");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Review queue")]);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("opens the page of a chosen item, closes, and changes no filter or URL", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: /Documents/ }));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/documents");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(window.location.search).toBe("");
  });

  it("toggles the theme from the action and closes", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "dark");
    await user.click(await screen.findByRole("option", { name: /Toggle theme/ }));
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });

  it("switches back to light when the theme is dark", async () => {
    mocks.theme.resolved = "dark";
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "theme{Enter}");
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
  });

  it("typing never writes a page filter: the URL stays clean and Enter on invoice-like text opens the invoice", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await searchBox(), "INV-2970");
    await screen.findByRole("option", { name: /INV-2970/ });
    expect(screen.queryByRole("group", { name: "Pages and actions" })).toBeNull();
    await user.keyboard("{Enter}");
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/invoices/i1");
    expect(window.location.search).toBe("");
  });

  it("walks one list across both groups with the arrows, Home and End", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    const box = await searchBox();
    await user.type(box, "do");
    await screen.findByRole("option", { name: /INV-2970/ });
    const options = () => screen.getAllByRole("option");
    expect(options()[0]).toHaveTextContent("Documents");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    expect(options()[1]).toHaveTextContent("INV-2970");
    await user.keyboard("{End}");
    expect(options()[options().length - 1]).toHaveAttribute("aria-selected", "true");
    expect(options()[options().length - 1]).toHaveTextContent("OLD-1");
    await user.keyboard("{ArrowDown}");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}{Home}{Enter}");
    expect(mocks.push).toHaveBeenCalledWith("/documents");
  });
});
