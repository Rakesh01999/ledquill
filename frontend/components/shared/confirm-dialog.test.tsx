import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
});

type Props = { pending?: boolean; error?: { title: string; message: string; items: string[] } | null };

function Harness({
  onConfirm = () => {},
  initialFocus,
  destructive,
  pending = false,
  error = null,
}: Props & { onConfirm?: () => void; initialFocus?: "cancel" | "confirm"; destructive?: boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={opener} onClick={() => setOpen(true)}>
        Open
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Restore invoice INV-1?"
        confirmLabel="Restore"
        pendingLabel="Restoring"
        pending={pending}
        error={error}
        initialFocus={initialFocus}
        destructive={destructive}
        returnFocusTo={opener}
        onConfirm={onConfirm}
      >
        <p>It returns to the invoice list.</p>
      </ConfirmDialog>
    </>
  );
}

describe("ConfirmDialog", () => {
  it("opens with the title and body, and focus on Cancel by default", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Open"));
    expect(await screen.findByRole("alertdialog", { name: "Restore invoice INV-1?" })).toBeInTheDocument();
    expect(screen.getByText("It returns to the invoice list.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  it("starts on the confirm button when asked, so Enter confirms", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness initialFocus="confirm" onConfirm={onConfirm} />);
    await user.click(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore" })).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes without confirming and returns focus to the opener", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByText("Open"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Open")).toHaveFocus();
  });

  it("Esc cancels", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Open"));
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("confirm calls onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByText("Open"));
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("while pending shows the pending label, disables both buttons and ignores Esc", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(screen.getByText("Open"));
    await screen.findByRole("alertdialog");
    rerender(<Harness pending />);
    expect(screen.getByRole("button", { name: "Restoring" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows an error inside the open dialog", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(screen.getByText("Open"));
    await screen.findByRole("alertdialog");
    rerender(<Harness error={{ title: "Could not restore", message: "The file is archived.", items: ["Restore the file first"] }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not restore");
    expect(screen.getByText("Restore the file first")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
