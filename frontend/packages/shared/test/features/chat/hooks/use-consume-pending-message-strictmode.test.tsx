import { render, waitFor } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { StrictMode, useLayoutEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeConversationAtom,
  activeConversationIdAtom,
  type Conversation,
  conversationsAtom,
  pendingMessageAtom,
} from "@/features/chat/atoms/chat-atom";
import { useConsumePendingMessage } from "@/features/chat/hooks/use-consume-pending-message";

// Empirical StrictMode reproduction mirroring Collaboration's topology: a reset
// useLayoutEffect (wipes conversations, like the real agent-switch reset) that
// runs BEFORE the passive consume effect, both double-invoked under
// <StrictMode>. The mocked `send` writes an optimistic message into the store
// exactly as the real `sendMessage` does. The reset is GUARDED by a last-reset
// view-key ref, exactly like the real Collaboration, so it runs once per view
// identity even when StrictMode double-invokes the effect on mount.
//
// These tests PIN two invariants: the parked message is sent at most ONCE
// (never double-sent / re-sent), AND — thanks to the ref guard — the optimistic
// row it wrote SURVIVES the double-mount (no dev-only "first send shows nothing"
// flicker). Re-parking on cleanup to save the row was rejected (it re-sends on a
// real navigation-away, a worse production bug); the ref guard achieves the same
// preservation without that risk by simply not re-resetting the same view.
let storeRef: ReturnType<typeof createStore> | null = null;
const send = vi.fn((text: string) => {
  if (storeRef) {
    const map = new Map(storeRef.get(conversationsAtom));
    const conv: Conversation = {
      clientId: "c1",
      history: [
        {
          id: "h",
          author: "human",
          content: [{ partId: "p", type: "text", text }],
        },
      ],
    };
    map.set("c1", conv);
    storeRef.set(conversationsAtom, map);
    storeRef.set(activeConversationIdAtom, "c1");
  }
  return Promise.resolve(undefined);
});
vi.mock("@/features/chat/hooks/use-chat", () => ({
  useChat: () => ({ send, stop: vi.fn(), upload: vi.fn() }),
}));

// Miniature Collaboration: guarded reset (layout) then consume (passive). The
// ref guard mirrors the real component so the reset runs once per view key.
function Harness({
  store,
  agentInstanceId,
  conversationId,
}: {
  store: ReturnType<typeof createStore>;
  agentInstanceId: number;
  conversationId: number;
}): null {
  const lastResetKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const viewKey = `${agentInstanceId}:${conversationId}`;
    if (lastResetKeyRef.current === viewKey) {
      return;
    }
    lastResetKeyRef.current = viewKey;
    store.set(conversationsAtom, new Map());
    store.set(activeConversationIdAtom, null);
  }, [store, agentInstanceId, conversationId]);
  useConsumePendingMessage(agentInstanceId, conversationId);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useConsumePendingMessage under StrictMode (Collaboration topology)", () => {
  it("sends the parked message exactly once across the double-mount", async () => {
    const store = createStore();
    storeRef = store;
    store.set(pendingMessageAtom, {
      agentInstanceId: 1,
      conversationId: 7,
      text: "ship it",
      attachments: [],
    });
    render(
      <StrictMode>
        <JotaiProvider store={store}>
          <Harness store={store} agentInstanceId={1} conversationId={7} />
        </JotaiProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(send).toHaveBeenCalled());
    // The invariant that matters: at most one delivery, never a double-send.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("drains the slot so it can't fire again on a later mount", async () => {
    const store = createStore();
    storeRef = store;
    store.set(pendingMessageAtom, {
      agentInstanceId: 1,
      conversationId: 7,
      text: "ship it",
      attachments: [],
    });
    render(
      <StrictMode>
        <JotaiProvider store={store}>
          <Harness store={store} agentInstanceId={1} conversationId={7} />
        </JotaiProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(store.get(pendingMessageAtom)).toBeNull();
  });

  it("preserves the optimistic message across the double-mount (ref-guarded reset)", async () => {
    const store = createStore();
    storeRef = store;
    store.set(pendingMessageAtom, {
      agentInstanceId: 1,
      conversationId: 7,
      text: "ship it",
      attachments: [],
    });
    render(
      <StrictMode>
        <JotaiProvider store={store}>
          <Harness store={store} agentInstanceId={1} conversationId={7} />
        </JotaiProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(send).toHaveBeenCalled());
    // The guard skips StrictMode's second reset, so the row `send` wrote is NOT
    // wiped — the message the user just sent stays on screen. Without the guard
    // the second reset clears conversations and this is undefined (the dev-only
    // "first send shows nothing" artifact this fix removes).
    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history[0]?.content[0]).toEqual(
        {
          partId: "p",
          type: "text",
          text: "ship it",
        },
      ),
    );
  });
});
