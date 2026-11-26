import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { SlidingTabs } from "./sliding-tabs";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.scrollTo = () => {};
  window.matchMedia ??= (() => ({ matches: false })) as unknown as typeof window.matchMedia;
});

const ITEMS = [
  { key: "all", label: "All", count: 12 },
  { key: "failed", label: "Failed", count: 2 },
  { key: "done", label: "Completed", count: 9 },
];

function Harness() {
  const [value, setValue] = useState("all");
  return <SlidingTabs label="Filter" items={ITEMS} value={value} onValueChange={setValue} />;
}

describe("SlidingTabs", () => {
  it("is a tablist with one selected tab in the tab order", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Filter" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it("moves focus with the arrow keys, wraps, and selects on Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const [all, failed, done] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement, HTMLElement];
    all.focus();
    await user.keyboard("{ArrowRight}");
    expect(failed).toHaveFocus();
    await user.keyboard("{End}");
    expect(done).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(all).toHaveFocus();
    await user.keyboard("{ArrowLeft}{Enter}");
    expect(done).toHaveAttribute("aria-selected", "true");
  });

  it("renders link tabs for items with an href", () => {
    render(<SlidingTabs label="Status" items={[{ key: "a", label: "A", href: "/x?s=a" }, { key: "b", label: "B", href: "/x?s=b" }]} value="b" />);
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("href", "/x?s=b");
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true");
  });
});
