import { toast } from "@sico/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  activeConversationIdAtom,
  conversationsAtom,
} from "@/features/chat/atoms/chat-atom";
import { Composer } from "@/features/chat/components/composer";
import { logger } from "@/utils/logger";

const send = vi.fn().mockResolvedValue(undefined);
const stop = vi.fn().mockResolvedValue(undefined);
const upload = vi.fn().mockResolvedValue({
  id: 1,
  name: "pasted.png",
  size: 1,
  type: "image/png",
  uri: "u",
  sasUrl: "s",
});
vi.mock("@/features/chat/hooks/use-chat", () => ({
  useChat: () => ({ send, stop, upload }),
}));

// Partial-mock @sico/ui: stub `toast` (the hook surfaces upload failures
// through it) while keeping every other export real so InputGroup/Button/
// Spinner still render. Mirrors app/test/routes/login.test.tsx.
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return {
    ...actual,
    toast: { error: vi.fn() },
  };
});

const mockedToastError = vi.mocked(toast.error);

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  // Named function declaration (not an inline arrow) to satisfy
  // react/display-name + react/function-component-definition, matching the
  // sibling message-list.test.tsx `Wrapper`.
  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  }

  return Wrapper;
}

describe("Composer", () => {
  it("hides the send button when the input is empty", () => {
    const store = createStore();
    render(<Composer agentInstanceId={1} />, { wrapper: withStore(store) });
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
  });

  it("shows the send button once text is entered", async () => {
    const store = createStore();
    render(<Composer agentInstanceId={1} />, { wrapper: withStore(store) });
    await userEvent.type(screen.getByLabelText("Message input"), "hi");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("rejects an over-cap file with an inline message", async () => {
    const store = createStore();
    render(<Composer agentInstanceId={1} />, { wrapper: withStore(store) });
    const big = new File([new Uint8Array(17 * 1024 * 1024)], "big.bin");
    const input = screen.getByLabelText("Attach a file") as HTMLInputElement;
    await userEvent.upload(input, big);
    expect(screen.getByText(/over 16 MB/i)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads a pasted file through the same path as the picker", async () => {
    const store = createStore();
    upload.mockClear();
    render(<Composer agentInstanceId={1} />, { wrapper: withStore(store) });
    const file = new File(["x"], "pasted.png", { type: "image/png" });
    fireEvent.paste(screen.getByLabelText("Message input"), {
      clipboardData: { files: [file] },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload.mock.calls[0]?.[0]).toBe(file);
  });

  it("calls send() with the draft on submit", async () => {
    const store = createStore();
    render(<Composer agentInstanceId={1} />, { wrapper: withStore(store) });
    await userEvent.type(screen.getByLabelText("Message input"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    // Third arg is the target conversationId — undefined here (no conversationId
    // prop on a bare Composer; sico v1 / not threaded in this test).
    expect(send).toHaveBeenCalledWith("hello", [], undefined);
  });

  it("toasts and drops the chip when an upload genuinely fails", async () => {
    const store = createStore();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    upload.mockRejectedValueOnce(new Error("boom"));
    render(<Composer agentInstanceId={1} />, { wrapper: withStore(store) });
    const file = new File(["x"], "report.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText("Attach a file") as HTMLInputElement;
    await userEvent.upload(input, file);
    await waitFor(() => expect(mockedToastError).toHaveBeenCalled());
    // The chip is removed on failure (no persistent error chip).
    expect(screen.queryByText("report.pdf")).toBeNull();
    // A genuine upload failure leaves a diagnostic trail, mirroring the SSE
    // path in chat.ts (M15) — not a silently swallowed catch.
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("stays silent (no toast, no error log) when an in-flight upload is removed", async () => {
    const store = createStore();
    mockedToastError.mockClear();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    // A never-settling upload that rejects with the abort reason once the
    // chip's controller is aborted — models the real transport on caller-abort.
    upload.mockImplementationOnce(
      (_file: File, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    render(<Composer agentInstanceId={1} />, { wrapper: withStore(store) });
    const file = new File(["x"], "removing.txt", { type: "text/plain" });
    const input = screen.getByLabelText("Attach a file") as HTMLInputElement;
    await userEvent.upload(input, file);
    // Remove the still-uploading chip → aborts its controller.
    const remove = await screen.findByRole("button", {
      name: "Remove attachment",
    });
    await userEvent.click(remove);
    await waitFor(() => expect(screen.queryByText("removing.txt")).toBeNull());
    // Abort is an expected user action — neither a toast nor an error log fires.
    expect(mockedToastError).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("disables send while an attachment is still uploading", async () => {
    const store = createStore();
    // Never-settling upload holds the chip in `uploading`.
    upload.mockReturnValueOnce(new Promise(() => {}));
    render(<Composer agentInstanceId={1} />, { wrapper: withStore(store) });
    await userEvent.type(screen.getByLabelText("Message input"), "hi");
    const file = new File(["x"], "small.txt", { type: "text/plain" });
    const input = screen.getByLabelText("Attach a file") as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("routes the Stop click through use-chat.stop with the reconnect stop()", async () => {
    const store = createStore();
    stop.mockClear();
    // Seed a streaming tail so the ■ Stop button renders (isStreamingAtom).
    store.set(
      conversationsAtom,
      new Map([
        [
          "c1",
          {
            clientId: "c1",
            history: [
              {
                id: "ai",
                author: "ai" as const,
                streamingState: "streaming" as const,
                content: [{ partId: "p", type: "text" as const, text: "hi" }],
              },
            ],
          },
        ],
      ]),
    );
    store.set(activeConversationIdAtom, "c1");
    // Pass reconnectStop as a prop (Collaboration threads it down from
    // useReconnect's stop()).
    const reconnectStop = vi.fn();
    render(<Composer agentInstanceId={1} reconnectStop={reconnectStop} />, {
      wrapper: withStore(store),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Stop response" }),
    );

    // The composer no longer aborts directly — it delegates to the plan-aware
    // orchestrator, handing it the reconnect manager's stop() (G4).
    expect(stop).toHaveBeenCalledWith(reconnectStop);
  });

  // Controlled mode — the empty-state ConversationStarter owns the draft (for
  // suggested-task prefill) and overrides submit (park-then-navigate).
  it("reflects a controlled value in the textarea (starter prefill)", () => {
    const store = createStore();
    render(
      <Composer agentInstanceId={1} value="prefilled" onChange={vi.fn()} />,
      { wrapper: withStore(store) },
    );
    expect(screen.getByLabelText("Message input")).toHaveValue("prefilled");
  });

  it("forwards typing through onChange in controlled mode", async () => {
    const store = createStore();
    const onChange = vi.fn();
    render(<Composer agentInstanceId={1} value="" onChange={onChange} />, {
      wrapper: withStore(store),
    });
    await userEvent.type(screen.getByLabelText("Message input"), "x");
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("routes submit through onSubmit with text + refs instead of send()", async () => {
    const store = createStore();
    const onSubmit = vi.fn();
    render(
      <Composer
        agentInstanceId={1}
        value="ship it"
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />,
      { wrapper: withStore(store) },
    );
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSubmit).toHaveBeenCalledWith("ship it", []);
    expect(send).not.toHaveBeenCalled();
  });

  it("does NOT clear the draft on the onSubmit path (caller owns clear; failure keeps text + attachments)", async () => {
    const store = createStore();
    const onChange = vi.fn();
    render(
      <Composer
        agentInstanceId={1}
        value="ship it"
        onChange={onChange}
        onSubmit={vi.fn()}
      />,
      { wrapper: withStore(store) },
    );
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    // The Composer must not empty the controlled field — a create failure needs
    // the draft (and its attachments, held internally) to survive for retry.
    expect(onChange).not.toHaveBeenCalledWith("");
  });

  it("shows the Sending… spinner and disables input while submitting", () => {
    const store = createStore();
    render(
      <Composer
        agentInstanceId={1}
        value="ship it"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        submitting
      />,
      { wrapper: withStore(store) },
    );
    expect(
      screen.getByRole("button", { name: "Sending…" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message input")).toBeDisabled();
  });

  it("ignores a resubmit while submitting (debounce the create round-trip)", async () => {
    const store = createStore();
    const onSubmit = vi.fn();
    render(
      <Composer
        agentInstanceId={1}
        value="ship it"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        submitting
      />,
      { wrapper: withStore(store) },
    );
    // The Send button is replaced by the non-interactive Sending… spinner, so a
    // click can't re-fire onSubmit.
    await userEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
