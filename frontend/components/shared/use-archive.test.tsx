import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useArchiveActions } from "./use-archive";

const post = vi.fn();
vi.mock("@/lib/api/client", () => ({
  api: { POST: (...args: unknown[]) => post(...args) },
  unwrap: async (promise: Promise<{ data?: unknown; error?: unknown }>) => {
    const result = await promise;
    if (result.error) throw new Error("failed");
    return result.data;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(() => "t1"), error: vi.fn(), loading: vi.fn() }) }));

beforeEach(() => {
  post.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.loading).mockClear();
  vi.mocked(toast.error).mockClear();
});

function Screen() {
  const actions = useArchiveActions();
  return <button onClick={() => void actions.archive("invoice", "i1", "INV-7")}>Archive</button>;
}

async function archiveAndGetUndo() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Screen />
    </QueryClientProvider>,
  );
  await user.click(screen.getByText("Archive"));
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  const options = vi.mocked(toast.success).mock.calls[0]?.[1] as unknown as {
    action: { onClick: (e: { preventDefault: () => void }) => void };
  };
  return options.action.onClick;
}

describe("Undo toast", () => {
  it("turns into a loading toast with the same id, then a success toast", async () => {
    post.mockResolvedValue({ data: {} });
    const undo = await archiveAndGetUndo();
    const preventDefault = vi.fn();
    undo({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(toast.loading).toHaveBeenCalledWith("Restoring INV-7", expect.objectContaining({ id: "t1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Restored INV-7", expect.objectContaining({ id: "t1" })));
  });

  it("ignores a second click while the restore runs", async () => {
    let finish: (value: unknown) => void = () => {};
    post.mockResolvedValueOnce({ data: {} }); // the archive
    post.mockReturnValueOnce(new Promise((resolve) => (finish = resolve))); // the restore
    const undo = await archiveAndGetUndo();
    undo({ preventDefault: () => {} });
    undo({ preventDefault: () => {} });
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
    finish({ data: {} });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
  });

  it("shows a failed restore as an error toast with the same id", async () => {
    post.mockResolvedValueOnce({ data: {} });
    post.mockResolvedValueOnce({ error: { title: "Conflict" } });
    const undo = await archiveAndGetUndo();
    undo({ preventDefault: () => {} });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ id: "t1" })));
  });
});
