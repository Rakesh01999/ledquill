import { describe, expect, it } from "vitest";
import { buildGroups, highlightParts, seeAllHref, type GlobalSearchData } from "./global-search";

const empty = { items: [], more: false };
const data = (patch: Partial<GlobalSearchData>): GlobalSearchData => ({
  q: "x",
  documents: empty,
  invoices: empty,
  suppliers: empty,
  archived: empty,
  ...patch,
});

describe("highlightParts", () => {
  const joined = (text: string, q: string) =>
    highlightParts(text, q).map((p) => (p.hit ? `[${p.text}]` : p.text)).join("");

  it("marks the query in any case, and each word of it", () => {
    expect(joined("Acme Supplies Ltd", "acme")).toBe("[Acme] Supplies Ltd");
    expect(joined("Acme Supplies Ltd", "supp ltd")).toBe("Acme [Supp]lies [Ltd]");
    expect(joined("INV-2970-B", "2970")).toBe("INV-[2970]-B");
  });

  it("marks every occurrence and merges touching ones", () => {
    expect(joined("abab", "ab")).toBe("[abab]");
    expect(joined("a.b.a", "a")).toBe("[a].b.[a]");
  });

  it("treats regex characters and wildcards as plain text", () => {
    expect(joined("100% (Natural)", "100%")).toBe("[100%] (Natural)");
    expect(joined("a.c abc", "a.c")).toBe("[a.c] abc"); // "." is not "any character"
    expect(joined("x+y", "x+")).toBe("[x+]y");
    expect(joined("(group", "(")).toBe("[(]group");
  });

  it("never turns markup into markup: the text stays text", () => {
    const parts = highlightParts("<img src=x onerror=alert(1)>", "img");
    expect(parts.map((p) => p.text).join("")).toBe("<img src=x onerror=alert(1)>");
    expect(parts.find((p) => p.hit)?.text).toBe("img");
  });

  it("returns the text unmarked when there is nothing to mark or lowercasing shifts positions", () => {
    expect(highlightParts("Acme", "zzz")).toEqual([{ text: "Acme", hit: false }]);
    expect(highlightParts("Acme", "   ")).toEqual([{ text: "Acme", hit: false }]);
    expect(highlightParts("İstanbul", "stan")).toEqual([{ text: "İstanbul", hit: false }]);
  });
});

describe("buildGroups", () => {
  it("builds rows with a secondary line and drops empty groups", () => {
    const groups = buildGroups(
      data({
        invoices: {
          more: true,
          items: [
            { id: "i1", document_id: "d1", invoice_number: "INV-1", supplier_name: "Acme Ltd", total: "2970.0000", currency: "USD", invoice_date: "2026-09-01", status: "ready" },
            { id: "i2", document_id: "d1", invoice_number: null, supplier_name: null, total: null, currency: null, invoice_date: null, status: "needs_review" },
          ],
        },
        suppliers: { more: false, items: [{ supplier: "Acme Ltd", count: 1 }] },
      }),
    );
    expect(groups.map((g) => g.key)).toEqual(["invoices", "suppliers"]);
    const [first, second] = groups[0]!.rows;
    expect(first).toMatchObject({ title: "INV-1", detail: "Acme Ltd · USD 2,970.00 · 1 Sep 2026", href: "/invoices/i1", status: "ready", archived: false });
    expect(second).toMatchObject({ title: "No invoice number", detail: "Supplier not found" });
    expect(groups[0]!.more).toBe(true);
    // a supplier opens the list filtered to that exact name
    expect(groups[1]!.rows[0]).toMatchObject({ detail: "1 invoice", href: "/invoices?supplier=Acme+Ltd" });
  });

  it("keeps archived items in their own marked group and links them to their page", () => {
    const groups = buildGroups(
      data({
        archived: {
          more: false,
          items: [
            { kind: "invoice", id: "i9", document_id: "d9", title: "OLD-1", detail: "Acme · USD 5.00", archived_at: "2026-11-01T00:00:00Z" },
            { kind: "document", id: "d9", document_id: "d9", title: "old.pdf", detail: "PDF", archived_at: "2026-11-01T00:00:00Z" },
          ],
        },
      }),
    );
    expect(groups).toHaveLength(1);
    const [invoice, document] = groups[0]!.rows;
    expect(invoice).toMatchObject({ archived: true, href: "/invoices/i9", detail: "Invoice · Acme · USD 5.00" });
    expect(document).toMatchObject({ archived: true, href: "/documents/d9", detail: "Document · PDF" });
  });

  it("is empty when nothing matched, and builds the see-all URL from the Part 2 filters", () => {
    expect(buildGroups(data({}))).toEqual([]);
    expect(seeAllHref("acme ltd")).toBe("/invoices?q=acme+ltd");
    expect(seeAllHref("100%")).toBe("/invoices?q=100%25");
  });
});
