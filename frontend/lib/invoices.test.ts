import { describe, expect, it } from "vitest";
import { defaultOrder, invoicesHref, parseInvoiceParams } from "./invoices";

const parse = (query: string) => parseInvoiceParams(new URLSearchParams(query));

describe("invoice list URL state", () => {
  it("reads repeated suppliers and currencies and drops duplicates and bad codes", () => {
    const p = parse("supplier=Acme&supplier=Globex+Trading&supplier=Acme&currency=usd&currency=EUR&currency=EURO");
    expect(p.supplier).toEqual(["Acme", "Globex Trading"]);
    expect(p.currency).toEqual(["USD", "EUR"]);
  });

  it("still reads the old single-value links", () => {
    expect(parse("supplier=Acme&currency=usd")).toMatchObject({ supplier: ["Acme"], currency: ["USD"] });
  });

  it("round-trips every filter, the sort, the page and the size", () => {
    const url = "supplier=A&supplier=B&currency=USD&currency=EUR&status=ready&sort=total&order=asc&page=3&size=50&q=toner";
    const p = parse(url);
    const again = parse(invoicesHref(p).split("?")[1] ?? "");
    expect(again).toEqual(p);
    expect(p).toMatchObject({ sort: "total", order: "asc", page: 3, size: 50, status: "ready" });
  });

  it("does not write a column's default direction, and ignores a direction with no column", () => {
    expect(invoicesHref(parse("sort=total&order=desc"))).toBe("/invoices?sort=total");
    expect(defaultOrder("total")).toBe("desc");
    expect(defaultOrder("supplier")).toBe("asc");
    expect(parse("order=asc").order).toBeUndefined();
    expect(parse("sort=bogus").sort).toBeUndefined();
  });

  it("resets nothing by itself: an empty URL is the plain list", () => {
    expect(invoicesHref(parse(""))).toBe("/invoices");
  });
});
