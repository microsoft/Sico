import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  activeConversationAtom,
  activeConversationIdAtom,
  conversationsAtom,
  createFirstConversationIdsAtom,
} from "@/features/chat/atoms/chat-atom";
import { useChat } from "@/features/chat/hooks/use-chat";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/chat/services/chat-stream", () => ({
  openChatStream: vi.fn(
    async (
      _payload: unknown,
      opts: { onOpen?: () => void; onEvent: (e: unknown) => void },
    ) => {
      opts.onOpen?.();
      opts.onEvent({ event: "message", data: { type: 1, content: "hi" } });
      opts.onEvent({ event: "done", data: { timestamp: 1 } });
    },
  ),
}));

const apiClient = axios.create({ baseURL: "/api/sico" });

function wrapper(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  // useChat now reads useQueryClient (to invalidate history on turn settle), so
  // the harness needs a QueryClientProvider.
  const queryClient = new QueryClient();

  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </JotaiProvider>
      </QueryClientProvider>
    );
  }

  return Wrapper;
}

describe("useChat", () => {
  it("send() runs the turn and ends in done", async () => {
    const store = createStore();
    const { result } = renderHook(() => useChat(1), {
      wrapper: wrapper(store),
    });
    await act(async () => {
      await result.current.send("hello", []);
    });
    await waitFor(() => {
      const conv = store.get(activeConversationAtom);
      expect(conv?.history.at(-1)).toMatchObject({
        author: "ai",
        streamingState: "done",
      });
    });
  });

  it("clears the create-first marker when the send settles", async () => {
    const store = createStore();
    const conversationId = 99;
    // The conversation was marked create-first at mint; its first send is about
    // to settle, after which page 1 holds real history (no twin) — the marker
    // must be dropped so a later cold revisit + in-flight send never skips it.
    store.set(createFirstConversationIdsAtom, new Set([conversationId]));
    const { result } = renderHook(() => useChat(1), {
      wrapper: wrapper(store),
    });
    await act(async () => {
      await result.current.send("hello", [], conversationId);
    });
    await waitFor(() =>
      expect(
        store.get(createFirstConversationIdsAtom).has(conversationId),
      ).toBe(false),
    );
  });

  it("stop() tears down a text-only turn through the reconnect stop() and the chat handle", async () => {
    const store = createStore();
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");
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
            sendHandle: controller,
          },
        ],
      ]),
    );
    store.set(activeConversationIdAtom, "c1");
    const reconnectStop = vi.fn();
    const { result } = renderHook(() => useChat(1), {
      wrapper: wrapper(store),
    });

    await act(async () => {
      await result.current.stop(reconnectStop);
    });

    expect(reconnectStop).toHaveBeenCalledOnce();
    expect(abortSpy).toHaveBeenCalledOnce();
  });
});
