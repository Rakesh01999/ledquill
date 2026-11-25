import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { makeInvoice } from "@/test/fixtures";
import { LineItems } from "./line-items";

type Item = { description: string | null; quantity: string | null; unit_price: string | null; amount: string | null };

function cells(description: string): string[] {
  const row = screen.getByText(description).closest("tr");
  if (!row) throw new Error(`no row for ${description}`);
  return within(row)
    .getAllByRole("cell")
    .map((c) => c.textContent ?? "");
}

function renderItems(items: Item[]) {
  const invoice = makeInvoice({ line_items: items.map((i, n) => ({ line_no: n + 1, ...i })) });
  return render(
    <TooltipProvider>
      <LineItems invoice={invoice} />
    </TooltipProvider>,
  );
}

describe("line item numbers", () => {
  it("shows zero as a value, never as missing", () => {
    renderItems([{ description: "Zero row", quantity: "0", unit_price: "0", amount: "0" }]);
    const [, , qty, price, amount] = cells("Zero row");
    expect(qty).toBe("0");
    expect(price).toBe("0.00");
    expect(amount).toBe("0.00");
  });

  it("shows whole quantities and prints money with two decimals", () => {
    renderItems([{ description: "Twenty", quantity: "20", unit_price: "99.0000", amount: "1980.0000" }]);
    const [, , qty, price, amount] = cells("Twenty");
    expect(qty).toBe("20");
    expect(price).toBe("99.00");
    expect(amount).toBe("1,980.00");
  });

  it("shows a dash only for null values", () => {
    renderItems([{ description: "Empty row", quantity: null, unit_price: null, amount: null }]);
    const [, , qty, price, amount] = cells("Empty row");
    for (const text of [qty, price, amount]) expect(text).toContain("—");
  });

  it("right-aligns the numeric columns", () => {
    renderItems([{ description: "Aligned", quantity: "1", unit_price: "1", amount: "1" }]);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.slice(2).every((h) => h.className.includes("text-right"))).toBe(true);
  });
});
