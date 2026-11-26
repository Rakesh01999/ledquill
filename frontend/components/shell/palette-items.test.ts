import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./nav";
import { PALETTE_ITEMS, matchItems } from "./palette-items";

const labels = (text: string) => matchItems(text).map((i) => i.label);

describe("matchItems", () => {
  it("lists every page and the one action for empty text, in menu order", () => {
    expect(labels("")).toEqual([...NAV_ITEMS.map((n) => n.label), "Toggle theme"]);
    expect(labels("   ")).toHaveLength(PALETTE_ITEMS.length);
    expect(PALETTE_ITEMS.filter((i) => i.kind === "action")).toHaveLength(1);
  });

  it("matches at the start of a word of the label, in any case", () => {
    expect(labels("doc")).toEqual(["Documents"]);
    expect(labels("REV")).toEqual(["Review queue"]);
    expect(labels("que")).toEqual(["Review queue"]);
    expect(labels("review q")).toEqual(["Review queue"]);
  });

  it("does not match the middle of a word", () => {
    expect(labels("ocuments")).toEqual([]);
    expect(labels("views")).toEqual([]);
  });

  it("matches the action by its keywords", () => {
    expect(labels("dark")).toEqual(["Toggle theme"]);
    expect(labels("light")).toEqual(["Toggle theme"]);
    expect(labels("theme")).toEqual(["Toggle theme"]);
  });

  it("finds nothing for text that matches no page", () => {
    expect(labels("zzz")).toEqual([]);
  });

  it("does not match invoice-like text, so Enter opens the invoice, not a page", () => {
    expect(labels("INV-204")).toEqual([]);
    expect(labels("inv-2970")).toEqual([]);
    expect(labels("2970")).toEqual([]);
    expect(labels("204")).toEqual([]);
    expect(labels("2,970.00")).toEqual([]);
  });

  it("treats regex characters as plain text", () => {
    expect(labels(".*")).toEqual([]);
    expect(labels("(")).toEqual([]);
  });
});
