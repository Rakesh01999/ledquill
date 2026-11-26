import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfirmedActions } from "./use-confirmed-actions";

const post = vi.fn();
vi.mock("@/lib/api/client", () => ({
  api: { POST: (...args: unknown[]) => post(...args) },
  unwrap: async (promise: Promise<{ data?: unknown; error?: unknown }>) => {
    const result = await promise;
    if (result.error) throw new Error("failed");
    return result.data;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
});
beforeEach(() => post.mockReset());

function Screen({ perform }: { perform: () => Promise<unknown> }) {
  const actions = useConfirmedActions();
  return (
    <>
      <button onClick={() => actions.askRestore("invoice", "i1", "INV-7")}>Restore it</button>
      <button onClick={() => actions.askApprove("INV-7", perform)}>Approve it</button>
      {actions.dialog}
    </>
  );
}

function setup(perform: () => Promise<unknown> = async () => {}) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Screen perform={perform} />
    </QueryClientProvider>,
  );
}

describe("useConfirmedActions", () => {
  it("askRestore opens a dialog that names the item and sends nothing until confirmed", async () => {
    post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("Restore it"));
    expect(await screen.findByRole("alertdialog", { name: "Restore INV-7?" })).toBeInTheDocument();
    expect(screen.getByText(/returns to the active Invoices list/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toBe("/api/v1/invoices/{invoice_id}/restore");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("askRestore: Cancel sends nothing", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("Restore it"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
  });

  it("askRestore: a failed call stays in the dialog with its reason", async () => {
    post.mockResolvedValue({ error: { title: "Conflict" } });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("Restore it"));
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("askApprove focuses the Approve button and runs the caller's action on confirm", async () => {
    const perform = vi.fn(async () => {});
    const user = userEvent.setup();
    setup(perform);
    await user.click(screen.getByText("Approve it"));
    expect(await screen.findByRole("alertdialog", { name: "Approve INV-7?" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toHaveFocus());
    expect(perform).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("askApprove: Cancel does not run the action; a failure stays open", async () => {
    const user = userEvent.setup();
    const perform = vi.fn(async () => {
      throw new Error("conflict");
    });
    setup(perform);
    await user.click(screen.getByText("Approve it"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(perform).not.toHaveBeenCalled();

    await user.click(screen.getByText("Approve it"));
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
