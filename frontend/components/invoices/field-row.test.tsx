import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FIELD_GROUPS, type Issue } from "@/lib/invoices";
import { FieldRow, type FieldRowProps } from "./field-row";

const def = FIELD_GROUPS.flatMap((g) => g.fields).find((f) => f.name === "total")!;

function renderRow(props: Partial<FieldRowProps> = {}) {
  return render(
    <TooltipProvider>
      <FieldRow
        def={def}
        value="110.00"
        confidence={0.95}
        edited={false}
        pageLabel={null}
        issues={[]}
        onSave={vi.fn()}
        onShowPage={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

const issue = (severity: "error" | "warning", message = "m"): Issue => ({
  rule_id: "V-01",
  severity,
  field: "total",
  message,
  expected: null,
  actual: null,
  related_invoice_id: null,
});

describe("field issue markers say what is wrong in words, not colour alone", () => {
  it("marks an error with the word Error", () => {
    renderRow({ issues: [issue("error")] });
    expect(screen.getByRole("button", { name: /Error.*Show in the issues list/ })).toBeInTheDocument();
  });

  it("marks a warning with the word Warning and counts several issues", () => {
    renderRow({ issues: [issue("warning"), issue("warning", "other")] });
    expect(screen.getByRole("button", { name: /Warning \(2\)/ })).toBeInTheDocument();
  });

  it("says Low confidence and Check value in text", () => {
    const { unmount } = renderRow({ confidence: 0.4 });
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    unmount();
    renderRow({ confidence: 0.8 });
    expect(screen.getByText(/Check value/)).toBeInTheDocument();
  });

  it("shows no marker for a confident, clean field", () => {
    renderRow();
    expect(screen.queryByText(/Error|Warning|Low confidence|Check value/)).toBeNull();
  });
});

describe("field values", () => {
  it("formats money and keeps a zero total", () => {
    renderRow({ value: "0" });
    expect(screen.getByRole("button", { name: /Edit Total, current value 0\.00/ })).toBeInTheDocument();
  });

  it("says not found for a null value", () => {
    renderRow({ value: null });
    expect(screen.getByRole("button", { name: /Edit Total, not found in document/ })).toBeInTheDocument();
  });
});
