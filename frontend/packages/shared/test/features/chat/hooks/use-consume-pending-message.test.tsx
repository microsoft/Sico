/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { renderHook } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pendingMessageAtom } from "@/features/chat/atoms/chat-atom";
import { useConsumePendingMessage } from "@/features/chat/hooks/use-consume-pending-message";

const send = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/chat/hooks/use-chat", () => ({
  useChat: () => ({ send, stop: vi.fn(), upload: vi.fn() }),
}));

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  }

  return Wrapper;
}

// Fresh parked payload per test — the drain mutates the atom.
const makeParked = (): {
  agentInstanceId: number;
  conversationId: number;
  text: string;
  attachments: never[];
} => ({
  agentInstanceId: 1,
  conversationId: 7,
  text: "hi",
  attachments: [],
});

describe("useConsumePendingMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when no message is parked", () => {
    const store = createStore();
    renderHook(() => useConsumePendingMessage(1, 7), {
      wrapper: withStore(store),
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the parked message text, attachments, and conversationId", () => {
    const store = createStore();
    store.set(pendingMessageAtom, makeParked());
    renderHook(() => useConsumePendingMessage(1, 7), {
      wrapper: withStore(store),
    });
    // The parked conversationId (7) is forwarded so the send targets it even if
    // useHistory hasn't hydrated the slot yet.
    expect(send).toHaveBeenCalledWith("hi", [], 7);
  });

  it("clears the slot after consuming so a re-render can't double-send", () => {
    const store = createStore();
    store.set(pendingMessageAtom, makeParked());
    renderHook(() => useConsumePendingMessage(1, 7), {
      wrapper: withStore(store),
    });
    expect(store.get(pendingMessageAtom)).toBeNull();
  });

  it("sends exactly once across a re-render", () => {
    const store = createStore();
    store.set(pendingMessageAtom, makeParked());
    const { rerender } = renderHook(() => useConsumePendingMessage(1, 7), {
      wrapper: withStore(store),
    });
    rerender();
    expect(send).toHaveBeenCalledOnce();
  });

  it("does NOT send a message parked for a different agent", () => {
    const store = createStore();
    store.set(pendingMessageAtom, {
      agentInstanceId: 99,
      conversationId: 7,
      text: "hi",
      attachments: [],
    });
    renderHook(() => useConsumePendingMessage(1, 7), {
      wrapper: withStore(store),
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("does NOT send a message parked for a different conversation", () => {
    const store = createStore();
    store.set(pendingMessageAtom, {
      agentInstanceId: 1,
      conversationId: 999,
      text: "hi",
      attachments: [],
    });
    renderHook(() => useConsumePendingMessage(1, 7), {
      wrapper: withStore(store),
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves a non-matching parked message intact for its own view", () => {
    const store = createStore();
    const parked = {
      agentInstanceId: 99,
      conversationId: 7,
      text: "hi",
      attachments: [],
    };
    store.set(pendingMessageAtom, parked);
    renderHook(() => useConsumePendingMessage(1, 7), {
      wrapper: withStore(store),
    });
    expect(store.get(pendingMessageAtom)).toEqual(parked);
  });
});
