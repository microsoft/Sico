import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { produce } from "immer";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Collaboration } from "@/features/chat";
import {
  activeConversationIdAtom,
  type Attachment,
  attachmentsAtom,
  type Conversation,
  conversationsAtom,
  plansAtom,
} from "@/features/chat/atoms/chat-atom";
import { sidepaneContentAtom } from "@/features/chat/atoms/sidepane-atom";
import { useHistory, type UseHistory } from "@/features/chat/hooks/use-history";
import { useReconnect } from "@/features/chat/hooks/use-reconnect";
import {
  PlanStatusSchema,
  PlanStepStatusSchema,
} from "@/features/chat/schemas/plan";
import { ApiClientProvider } from "@/services/api-client-context";

// The Composer renders inside Collaboration and reads `useChat`; stub it so the
// composer mounts without a real store/transport. `chatStop` is hoisted (so the
// hoisted `vi.mock` factory can close over it) and lets the wiring test assert
// Composer's Stop reaches use-chat carrying the reconnect manager's stop()
// (Collaboration → Composer → use-chat).
const { chatStop } = vi.hoisted(() => ({
  chatStop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/chat/hooks/use-chat", () => ({
  useChat: () => ({ send: vi.fn(), stop: chatStop, upload: vi.fn() }),
}));

// A mounted plan card now owns a `/plan` poll; stub only the network boundary
// so the agent-context wiring test never hits the stub axios client.
vi.mock("@/features/chat/services/plan", async (importActual) => {
  const actual =
    await importActual<typeof import("@/features/chat/services/plan")>();
  return { ...actual, fetchPlan: vi.fn() };
});

// A turn's ExperiencePill calls `useNavigate` for its `View more` jump; this
// suite renders Collaboration outside a RouterProvider, so stub the router hook
// to keep the tree mountable and the output warning-free.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// `use-history` carries its own thorough suite; here we stub it to assert
// Collaboration WIRES it (called with the agent id, pager flows to the list,
// reset clears its atoms).
vi.mock("@/features/chat/hooks/use-history", () => ({
  useHistory: vi.fn(),
}));

// `use-reconnect` carries its own suite; stub it so Collaboration mounts without
// firing a real reconnect probe (it only needs to return a `stop` handle).
vi.mock("@/features/chat/hooks/use-reconnect", () => ({
  useReconnect: vi.fn(),
}));

function mockHistory(overrides: Partial<UseHistory> = {}): void {
  vi.mocked(useHistory).mockReturnValue({
    isPending: false,
    hasMore: false,
    fetchOlder: vi.fn(),
    isFetchingOlder: false,
    ...overrides,
  });
}

const apiClient = {} as AxiosInstance;

beforeEach(() => {
  vi.clearAllMocks();
  // MessageList now mounts its reverse-pager sentinel unconditionally (so the
  // observer attaches even on a cold load), which constructs an
  // IntersectionObserver jsdom doesn't provide. Stub it the same way the
  // projects/digital-workers grid suites do — this integration test only cares
  // that Collaboration wires its parts, not that the observer fires.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  mockHistory();
  vi.mocked(useReconnect).mockReturnValue({ stop: vi.fn() });
});

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  // Named function declaration (not an inline arrow) to satisfy
  // react/display-name + react/function-component-definition, matching the
  // sibling composer.test.tsx `Wrapper`. The ExperiencePill nested in a turn
  // reads `useApiClient` + `useQuery` (for its owning projectId), so the base
  // wrapper provides both; Collaboration supplies the ChatAgentProvider itself.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <JotaiProvider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </JotaiProvider>
    );
  }

  return Wrapper;
}

// Production mounts Collaboration under an ApiClientProvider (its data hooks all
// read it); a mounted plan card's poll needs it too. Use this wrapper for tests
// that render a plan card so `use-plan`'s `useApiClient` resolves. The
// QueryClient also backs the turn's ExperiencePill `useQuery`.
function withApiClient(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <JotaiProvider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </JotaiProvider>
    );
  }

  return Wrapper;
}

// Seed an active conversation AFTER mount: the reset effect runs a harmless
// no-op on mount (empty store), so a pre-render seed would be wiped.
function seedConversation(
  store: ReturnType<typeof createStore>,
  conv: Conversation,
): void {
  act(() => {
    store.set(
      conversationsAtom,
      produce(store.get(conversationsAtom), (m) => {
        m.set(conv.clientId, conv);
      }),
    );
    store.set(activeConversationIdAtom, conv.clientId);
  });
}

describe("Collaboration", () => {
  it("mounts the composer", () => {
    const store = createStore();
    render(<Collaboration agentInstanceId={1} />, {
      wrapper: withStore(store),
    });
    expect(screen.getByLabelText("Message input")).toBeInTheDocument();
  });

  it("does not bleed the previous agent's history onto the next agent", () => {
    const store = createStore();
    const { rerender } = render(<Collaboration agentInstanceId={7} />, {
      wrapper: withStore(store),
    });
    seedConversation(store, {
      clientId: "c7",
      history: [
        {
          id: "h7",
          author: "human",
          content: [{ partId: "p7", type: "text", text: "agent-7-msg" }],
        },
      ],
    });
    expect(screen.getByText("agent-7-msg")).toBeInTheDocument();

    rerender(<Collaboration agentInstanceId={9} />);

    expect(screen.queryByText("agent-7-msg")).not.toBeInTheDocument();
  });

  it("does not bleed the previous agent's attachments onto the next agent", () => {
    const store = createStore();
    const { rerender } = render(<Collaboration agentInstanceId={7} />, {
      wrapper: withStore(store),
    });
    const attachment: Attachment = {
      localId: "a7",
      file: new File(["x"], "agent7.pdf", { type: "application/pdf" }),
      status: "ready",
      assetRef: {
        name: "agent7.pdf",
        size: 1,
        type: "application/pdf",
        uri: "u",
      },
    };
    act(() => {
      store.set(attachmentsAtom, [attachment]);
    });
    expect(screen.getByText("agent7.pdf")).toBeInTheDocument();

    rerender(<Collaboration agentInstanceId={9} />);

    expect(screen.queryByText("agent7.pdf")).not.toBeInTheDocument();
  });

  it("clears a half-typed draft on agent change", async () => {
    const store = createStore();
    const { rerender } = render(<Collaboration agentInstanceId={7} />, {
      wrapper: withStore(store),
    });
    await userEvent.type(screen.getByLabelText("Message input"), "half-typed");
    expect(screen.getByLabelText("Message input")).toHaveValue("half-typed");

    rerender(<Collaboration agentInstanceId={9} />);

    expect(screen.getByLabelText("Message input")).toHaveValue("");
  });

  it("aborts the previous agent's in-flight send before dropping the conversation", () => {
    const store = createStore();
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");
    const { rerender } = render(<Collaboration agentInstanceId={7} />, {
      wrapper: withStore(store),
    });
    seedConversation(store, {
      clientId: "c7",
      history: [{ id: "h7", author: "human", content: [] }],
      sendHandle: controller,
    });

    rerender(<Collaboration agentInstanceId={9} />);

    expect(abortSpy).toHaveBeenCalledOnce();
  });

  it("aborts the previous agent's in-flight uploads before clearing attachments", () => {
    const store = createStore();
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");
    const { rerender } = render(<Collaboration agentInstanceId={7} />, {
      wrapper: withStore(store),
    });
    act(() => {
      store.set(attachmentsAtom, [
        {
          localId: "a7",
          file: new File(["x"], "agent7.pdf", { type: "application/pdf" }),
          status: "uploading",
          abortHandle: controller,
        },
      ]);
    });

    rerender(<Collaboration agentInstanceId={9} />);

    expect(abortSpy).toHaveBeenCalledOnce();
  });

  it("wires useHistory to the agent instance + conversation on mount", () => {
    const store = createStore();
    render(<Collaboration agentInstanceId={42} conversationId={7} />, {
      wrapper: withStore(store),
    });
    expect(vi.mocked(useHistory)).toHaveBeenCalledWith(42, 7);
  });

  it("mounts useReconnect with the agent id, conversation id, and an onReplay handler", () => {
    const store = createStore();
    render(<Collaboration agentInstanceId={42} conversationId={7} />, {
      wrapper: withStore(store),
    });
    expect(vi.mocked(useReconnect)).toHaveBeenCalledWith(
      42,
      7,
      expect.objectContaining({ onReplay: expect.any(Function) }),
    );
  });

  it("threads the reconnect manager's stop() into the composer Stop (G4)", async () => {
    const reconnectStop = vi.fn();
    vi.mocked(useReconnect).mockReturnValue({ stop: reconnectStop });
    const store = createStore();
    render(<Collaboration agentInstanceId={7} />, {
      wrapper: withStore(store),
    });
    // Seed a streaming tail AFTER mount (the reset effect wipes a pre-seed) so
    // the composer shows the ■ Stop button.
    seedConversation(store, {
      clientId: "c7",
      history: [
        {
          id: "ai",
          author: "ai",
          streamingState: "streaming",
          content: [{ partId: "p", type: "text", text: "live" }],
        },
      ],
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Stop response" }),
    );

    // Stop routes through the reconnect manager's stop() (G4), not a bare abort —
    // Collaboration owns useReconnect and threads stop() down to the Composer.
    expect(chatStop).toHaveBeenCalledWith(reconnectStop);
  });

  it("flows the history pager into MessageList (older-page spinner shows)", () => {
    mockHistory({ isFetchingOlder: true });
    const store = createStore();
    render(<Collaboration agentInstanceId={7} />, {
      wrapper: withStore(store),
    });
    expect(screen.getByLabelText("Loading older messages")).toBeInTheDocument();
  });

  it("resets plansAtom on agent change", () => {
    const store = createStore();
    const { rerender } = render(<Collaboration agentInstanceId={7} />, {
      wrapper: withStore(store),
    });
    act(() => {
      store.set(
        plansAtom,
        new Map([
          [
            "7",
            { planId: "7", status: PlanStatusSchema.enum.RUNNING, steps: [] },
          ],
        ]),
      );
    });

    rerender(<Collaboration agentInstanceId={9} />);

    expect(store.get(plansAtom).size).toBe(0);
  });

  it("closes the sidepane on agent change (no cross-agent deliverable leak)", () => {
    const store = createStore();
    const { rerender } = render(<Collaboration agentInstanceId={7} />, {
      wrapper: withStore(store),
    });
    // A deliverable preview open for agent 7. Without a reset, switching agents
    // would leave agent 7's file in the pane while the live context resolves
    // agent 9 — "Add to project" would then publish 7's file into 9's project.
    act(() => {
      store.set(sidepaneContentAtom, {
        kind: "file",
        filename: "agent7-deliverable.md",
        fileUrl: "https://host/test/default_space/0/agent7-deliverable.md",
        canAddToProject: true,
      });
    });

    rerender(<Collaboration agentInstanceId={9} />);

    expect(store.get(sidepaneContentAtom)).toBeNull();
  });

  // History is decoupled from message rendering: `useHistory` fetches
  // non-suspense and never throws, so a history failure (steady state: nothing
  // hydrated) leaves the optimistic message AND the Composer intact — the panel
  // is NOT replaced by the `ErrorView` fallback. `useHistory` is mocked here (its
  // own suite covers the toast-on-error); this asserts the integration guarantee.
  it("keeps the sent message and composer visible when history is unavailable", () => {
    const store = createStore();
    render(<Collaboration agentInstanceId={7} conversationId={7} />, {
      wrapper: withStore(store),
    });
    // A just-sent optimistic human message, as the send path would seed it.
    seedConversation(store, {
      clientId: "7",
      conversationId: 7,
      history: [
        {
          id: "optimistic",
          author: "human",
          content: [{ partId: "p", type: "text", text: "just sent this" }],
        },
      ],
    });

    // The message and the input both survive; no error fallback replaces them.
    expect(screen.getByText("just sent this")).toBeInTheDocument();
    expect(screen.getByLabelText("Message input")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("provides the agent id to a mounted plan card so it can render (and poll)", () => {
    // A plan card reads `agentInstanceId` from context to mount its poll; if
    // Collaboration did not provide it, `useChatAgentId` would throw and the
    // ErrorBoundary would swallow the whole subtree. Seeding a plan turn whose
    // tree is already in `plansAtom` proves the row renders — i.e. the context
    // resolved.
    const store = createStore();
    render(<Collaboration agentInstanceId={7} />, {
      wrapper: withApiClient(store),
    });
    act(() => {
      store.set(
        plansAtom,
        new Map([
          [
            "5",
            {
              planId: "5",
              status: PlanStatusSchema.enum.RUNNING,
              steps: [
                {
                  id: "0",
                  title: "Polled step",
                  status: PlanStepStatusSchema.enum.IN_PROGRESS,
                  toolCalls: [],
                },
              ],
            },
          ],
        ]),
      );
      store.set(
        conversationsAtom,
        produce(store.get(conversationsAtom), (m) => {
          m.set("c5", {
            clientId: "c5",
            history: [
              {
                id: "m5",
                author: "ai",
                turnId: 5,
                content: [{ partId: "5:0", type: "plan", planId: "5" }],
              },
            ],
          });
        }),
      );
      store.set(activeConversationIdAtom, "c5");
    });

    expect(screen.getByText("Polled step")).toBeInTheDocument();
    // No alert means the agent context resolved (no useChatAgentId throw).
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
