import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeConversationIdAtom,
  conversationsAtom,
  pendingMessageAtom,
} from "@/features/chat/atoms/chat-atom";
import { sidepaneContentAtom } from "@/features/chat/atoms/sidepane-atom";
import { DigitalWorkerHome } from "@/features/chat/components/digital-worker-home/digital-worker-home";
import { ApiClientProvider } from "@/services/api-client-context";

// Stub the data hooks at their boundary so the container mounts without a
// QueryClient or real transport. The agent feeds the hero; the suspense
// recommendation hook feeds the suggested-task list; useChat only supplies
// `upload` here; useCreateConversation mints the conversation on submit
// (create-first).
const agent = {
  id: 685,
  name: "Arena",
  role: "Tester",
  iconUri: "https://example.com/a.png",
};
vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useSuspenseQuery: () => ({ data: agent }),
    // `seedEmptyHistory` (called in handleSubmit) only needs get/set to exist.
    useQueryClient: () => ({
      getQueryData: () => undefined,
      setQueryData: vi.fn(),
    }),
  };
});
vi.mock("@/features/chat/hooks/use-chat", () => ({
  useChat: () => ({ send: vi.fn(), stop: vi.fn(), upload: vi.fn() }),
}));
vi.mock("@/features/chat/hooks/use-recommendation-tasks", () => ({
  useSuspenseRecommendationTasks: () => [
    { message: "Automate regression", icon: 2 },
  ],
}));
// The DW home now mounts <Sidepane />, so a pre-opened sandbox pane renders the
// SandboxPreviewer, which polls devices. Stub the poll to its pending state (a
// spinner, no network) — enough to prove the pane is present and responsive.
vi.mock("@/features/sandbox/hooks/use-sandbox-instances-query", () => ({
  useSandboxInstancesQuery: () => ({ isPending: true, data: undefined }),
}));
// create-first: the mutation resolves with the new conversation (id 501). The
// mock invokes `onSuccess` synchronously with that summary so the park + submit
// happen in-test without a real network round-trip. `isPending` is overridable
// per-test to exercise the composer's Sending… loading state.
const createMutate = vi.fn(
  (_vars: unknown, opts?: { onSuccess?: (data: { id: number }) => void }) => {
    opts?.onSuccess?.({ id: 501 });
  },
);
let createIsPending = false;
vi.mock("@/features/chat/hooks/use-create-conversation", () => ({
  useCreateConversation: () => ({
    mutate: createMutate,
    isPending: createIsPending,
  }),
}));

const apiClient = {} as AxiosInstance;

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <JotaiProvider store={store}>{children}</JotaiProvider>
      </ApiClientProvider>
    );
  }

  return Wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  createIsPending = false;
});

describe("DigitalWorkerHome", () => {
  it("renders the agent identity in the hero", () => {
    const store = createStore();
    render(<DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />, {
      wrapper: withStore(store),
    });
    expect(screen.getByText("Arena, Tester")).toBeInTheDocument();
  });

  it("renders the suggested tasks", () => {
    const store = createStore();
    render(<DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />, {
      wrapper: withStore(store),
    });
    expect(
      screen.getByRole("button", { name: /Automate regression/ }),
    ).toBeInTheDocument();
  });

  it("prefills the composer when a suggested task is clicked", async () => {
    const user = userEvent.setup();
    const store = createStore();
    render(<DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />, {
      wrapper: withStore(store),
    });
    await user.click(
      screen.getByRole("button", { name: /Automate regression/ }),
    );
    expect(screen.getByLabelText("Message input")).toHaveValue(
      "Automate regression",
    );
  });

  it("creates a conversation from the message on submit (no title — the backend names it)", async () => {
    const user = userEvent.setup();
    const store = createStore();
    render(<DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />, {
      wrapper: withStore(store),
    });
    await user.type(screen.getByLabelText("Message input"), "ship it");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(createMutate).toHaveBeenCalledWith(
      { agentInstanceId: 685 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("mints only ONE conversation on a same-tick double submit (no orphan)", async () => {
    const user = userEvent.setup();
    const store = createStore();
    // Pending mutation: don't resolve, so `submitting` state can't re-render the
    // button between the two clicks — only a SYNCHRONOUS ref guard prevents the
    // second POST /conversation (which would orphan the first). One override is
    // enough: the guard blocks the 2nd click so only ONE mutate call happens.
    createMutate.mockImplementationOnce(() => {});
    render(<DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />, {
      wrapper: withStore(store),
    });
    await user.type(screen.getByLabelText("Message input"), "ship it");
    const send = screen.getByRole("button", { name: "Send message" });
    // Two clicks in the same tick (fireEvent doesn't flush between calls).
    fireEvent.click(send);
    fireEvent.click(send);
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it("parks the composed message with the new conversation id after create", async () => {
    const user = userEvent.setup();
    const store = createStore();
    render(<DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />, {
      wrapper: withStore(store),
    });
    await user.type(screen.getByLabelText("Message input"), "ship it");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(store.get(pendingMessageAtom)).toEqual({
      agentInstanceId: 685,
      conversationId: 501,
      text: "ship it",
      attachments: [],
    });
  });

  it("calls onSubmitted with the new conversation id after parking", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const onSubmitted = vi.fn();
    render(
      <DigitalWorkerHome agentInstanceId={685} onSubmitted={onSubmitted} />,
      { wrapper: withStore(store) },
    );
    await user.type(screen.getByLabelText("Message input"), "ship it");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSubmitted).toHaveBeenCalledWith(501);
  });

  it("shows the Sending… spinner while the create-conversation mutation is pending", () => {
    createIsPending = true;
    const store = createStore();
    render(<DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />, {
      wrapper: withStore(store),
    });
    // The composer reflects the ~1.5s POST /conversation round-trip as a
    // non-stoppable spinner instead of a frozen page.
    expect(
      screen.getByRole("button", { name: "Sending…" }),
    ).toBeInTheDocument();
  });

  it("mounts the Sidepane so an opened sandbox pane renders (Device button works on home)", () => {
    // The header's Device button opens the pane by setting this shared atom.
    // Before the home mounted <Sidepane />, nothing read it here, so the click
    // was a no-op. Seed it (as the button would) AFTER mount — the mount-time
    // sidepane reset would wipe a pre-seed — and assert the pane shows.
    const store = createStore();
    render(<DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />, {
      wrapper: withStore(store),
    });
    act(() => {
      store.set(sidepaneContentAtom, { kind: "sandbox", agentInstanceId: 685 });
    });
    expect(
      screen.getByRole("region", { name: "Preview panel" }),
    ).toBeInTheDocument();
  });

  it("closes an open sidepane when switching to another DW's home (param-only switch)", () => {
    // DW nav links target the home (`/digital-worker/$agentId`), so switching
    // DWs is a param-only change (no remount). The sidepane atom is a shared
    // app-wide singleton; without a reset keyed on the agent, a pane opened on
    // DW A's home (via the header Device button) stays open on DW B's home.
    const store = createStore();
    const { rerender } = render(
      <DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />,
      { wrapper: withStore(store) },
    );
    act(() => {
      store.set(sidepaneContentAtom, { kind: "sandbox", agentInstanceId: 685 });
    });

    rerender(<DigitalWorkerHome agentInstanceId={999} onSubmitted={vi.fn()} />);

    expect(store.get(sidepaneContentAtom)).toBeNull();
  });

  it("shows an idle Send button even when another conversation is mid-stream (clears the leaked active id)", async () => {
    // Simulate arriving at the home from a still-streaming conversation: the
    // active-id atom points at it and its history carries a streaming AI turn.
    // The home composer belongs to no conversation, so it must NOT inherit that
    // streaming state (which would render a Stop button instead of Send).
    const user = userEvent.setup();
    const store = createStore();
    store.set(
      conversationsAtom,
      new Map([
        [
          "42",
          {
            clientId: "42",
            conversationId: 42,
            history: [
              {
                id: "m1",
                author: "ai" as const,
                content: [],
                streamingState: "streaming" as const,
              },
            ],
          },
        ],
      ]),
    );
    store.set(activeConversationIdAtom, "42");
    render(<DigitalWorkerHome agentInstanceId={685} onSubmitted={vi.fn()} />, {
      wrapper: withStore(store),
    });
    // The Stop button (leaked streaming state) must be gone regardless of draft.
    expect(
      screen.queryByRole("button", { name: "Stop response" }),
    ).not.toBeInTheDocument();
    // With text, the send affordance is the idle Send button, not a Stop.
    await user.type(screen.getByLabelText("Message input"), "hi");
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toBeInTheDocument();
  });
});
