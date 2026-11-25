import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BarChart, RowBars, StackedBar, type Bar } from "./charts";

const bars: Bar[] = [
  { key: "a", axis: "Jan", title: "January 2026", value: 4, href: "/invoices?date_from=2026-01-01&date_to=2026-01-31" },
  { key: "b", axis: "Feb", title: "February 2026", value: 0, href: "/invoices?date_from=2026-02-01&date_to=2026-02-28" },
  { key: "c", axis: "Mar", title: "March 2026", value: 1, href: "/invoices?date_from=2026-03-01&date_to=2026-03-31" },
];

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe("BarChart", () => {
  it("states every value in text, with singular and plural", () => {
    wrap(<BarChart bars={bars} unit={["invoice", "invoices"]} label="Invoices per month" />);
    expect(screen.getByLabelText(/January 2026: 4 invoices/)).toBeInTheDocument();
    expect(screen.getByLabelText(/March 2026: 1 invoice\b/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "February 2026: 0 invoices" })).toBeInTheDocument();
  });

  it("links non-empty bars to their list, and leaves empty ones as plain text", () => {
    wrap(<BarChart bars={bars} unit={["invoice", "invoices"]} label="Invoices per month" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", bars[0]?.href);
  });

  it("has one tab stop and moves between bars with the arrow keys", async () => {
    const user = userEvent.setup();
    wrap(<BarChart bars={bars} unit={["invoice", "invoices"]} label="Invoices per month" />);
    const tabbable = () => document.querySelectorAll('[tabindex="0"]');
    expect(tabbable()).toHaveLength(1);
    await user.tab();
    expect(screen.getByLabelText(/January 2026/)).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByLabelText(/March 2026/)).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByLabelText(/January 2026/)).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByLabelText(/March 2026/)).toHaveFocus();
    expect(tabbable()).toHaveLength(1);
  });
});

describe("RowBars and StackedBar", () => {
  it("writes each row's value and links it", () => {
    wrap(
      <RowBars
        label="Top suppliers"
        rows={[
          { key: "x", label: "Acme Ltd", value: 3, text: "3 invoices", note: "USD 330.00", href: "/invoices?supplier=Acme+Ltd" },
          { key: "y", label: "Globex", value: 1, text: "1 invoice" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /Acme Ltd.*3 invoices.*USD 330\.00/ })).toHaveAttribute("href", "/invoices?supplier=Acme+Ltd");
    expect(screen.getByText("1 invoice")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("gives every part a legend line with count and share, even a part with zero", () => {
    wrap(
      <StackedBar
        label="Invoices by status"
        segments={[
          { key: "a", label: "Needs review", value: 3, className: "bg-warn-dot", href: "/invoices?status=needs_review" },
          { key: "b", label: "Ready", value: 1, className: "bg-primary", href: "/invoices?status=ready" },
          { key: "c", label: "Approved", value: 0, className: "bg-ok", href: "/invoices?status=approved" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /^Needs review 3 75%$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Approved 0 0%$/ })).toBeInTheDocument();
    // only parts with a value get a segment in the bar
    expect(screen.getByLabelText("Needs review: 3 (75%). Open these invoices")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Approved: 0/)).toBeNull();
  });
});
