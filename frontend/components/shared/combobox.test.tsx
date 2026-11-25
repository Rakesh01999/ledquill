import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { Combobox } from "./combobox";
import { SortableHead } from "./sortable-head";

beforeAll(() => {
  // jsdom has no layout: Radix and the list scroll-into-view need these.
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const OPTIONS = [
  { value: "Acme Supplies Ltd", hint: 3 },
  { value: "Globex Trading", hint: 2 },
  { value: "Initech LLC", hint: 1 },
];

function Harness({ options = OPTIONS }: { options?: typeof OPTIONS }) {
  const [selected, setSelected] = useState<string[]>([]);
  return <Combobox label="Supplier" options={options} selected={selected} onChange={setSelected} />;
}

describe("Combobox", () => {
  it("filters as you type and says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Supplier/ }));
    const input = await screen.findByRole("combobox", { name: /search supplier/i });
    await user.type(input, "glob");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Globex Trading/ })).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("moves with the arrow keys, selects with Enter, and allows several", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Supplier/ }));
    const input = await screen.findByRole("combobox");
    await user.keyboard("{Enter}"); // first option
    await user.keyboard("{ArrowDown}{Enter}"); // second option
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[2]).toHaveAttribute("aria-selected", "false");
    expect(input).toHaveAttribute("aria-activedescendant", options[1]?.id);
    expect(screen.getByRole("button", { name: /Supplier.*2 selected/ })).toBeInTheDocument();
  });

  it("deselects a chosen option and clears the whole selection", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Supplier/ }));
    await user.click(await screen.findByRole("option", { name: /Initech/ }));
    await user.click(screen.getByRole("option", { name: /Initech/ }));
    expect(screen.getByRole("option", { name: /Initech/ })).toHaveAttribute("aria-selected", "false");
    await user.click(screen.getByRole("option", { name: /Acme/ }));
    await user.click(screen.getByRole("button", { name: /Clear selection/ }));
    expect(screen.getByRole("button", { name: /Supplier.*Any/ })).toBeInTheDocument();
  });

  it("closes on Escape and gives focus back to its button", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Supplier/ });
    await user.click(trigger);
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe("SortableHead", () => {
  const head = (direction?: "asc" | "desc") =>
    render(
      <table>
        <thead>
          <tr>
            <SortableHead direction={direction} nextHref="/invoices?sort=total">
              Total
            </SortableHead>
          </tr>
        </thead>
      </table>,
    );

  it.each([
    [undefined, "none"],
    ["asc", "ascending"],
    ["desc", "descending"],
  ] as const)("announces %s as aria-sort=%s", (direction, expected) => {
    head(direction);
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", expected);
    expect(screen.getByRole("link", { name: "Total" })).toHaveAttribute("href", "/invoices?sort=total");
  });
});
