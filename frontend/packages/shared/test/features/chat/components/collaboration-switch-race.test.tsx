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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import {
  type JSX,
  type PropsWithChildren,
  type ReactElement,
  Suspense,
  useEffect,
  useLayoutEffect,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeConversationAtom,
  activeConversationIdAtom,
  conversationsAtom,
  type Message,
} from "@/features/chat/atoms/chat-atom";
import { useHistory } from "@/features/chat/hooks/use-history";
import { fetchHistory } from "@/features/chat/services/history";
import { ApiClientProvider } from "@/services/api-client-context";

// Reproduces the agent-switch effect-ordering race that blanked the message
// area on a fast switch (issue: "快速切换 history 就不加载了"). The real
// Collaboration splits a RESET effect (parent) from useHistory's HYDRATE effect
// (child, inside MessageHistory). React runs child passive effects BEFORE parent
// passive effects, so on a CACHE HIT (no suspend) the child hydrate writes
// history, then the parent reset wipes it — leaving a blank message area with no
// spinner. The fix makes the reset a useLayoutEffect (layout phase runs before
// any passive effect), so reset always precedes hydrate.

vi.mock("@/features/chat/services/history");

const apiClient = {} as AxiosInstance;

function aiMessage(id: string, text: string): Message {
  return {
    id,
    author: "ai",
    content: [{ partId: `${id}:0`, type: "text", text }],
    turnId: Number(id),
  };
}

// Child: holds useHistory (its hydrate effect is the "child passive effect").
function MessageHistoryProbe({
  agentInstanceId,
}: {
  agentInstanceId: number;
}): JSX.Element {
  useHistory(agentInstanceId);
  return <div data-testid="history-ready" />;
}

// Parent mirror of Collaboration: a RESET effect that clears the store on agent
// change, then the child below it. `resetVariant` toggles the effect kind so the
// test can prove the bug (useEffect) and the fix (useLayoutEffect).
function CollaborationProbe({
  agentInstanceId,
  resetVariant,
}: {
  agentInstanceId: number;
  resetVariant: "effect" | "layout";
}): JSX.Element {
  const store = createStoreRef.current;
  const useReset = resetVariant === "layout" ? useLayoutEffect : useEffect;
  useReset(() => {
    store.set(conversationsAtom, new Map());
    store.set(activeConversationIdAtom, null);
  }, [agentInstanceId]);
  return (
    <Suspense fallback={<div data-testid="spinner" />}>
      <MessageHistoryProbe agentInstanceId={agentInstanceId} />
    </Suspense>
  );
}

// The probe reads the store via a ref so both effects share the one the test
// asserts against (renderHook-style wrappers can't thread it through props
// cleanly with a remount-free param change).
const createStoreRef: { current: ReturnType<typeof createStore> } = {
  current: createStore(),
};

function wrapper(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

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

beforeEach(() => {
  vi.mocked(fetchHistory).mockReset();
});

describe("Collaboration agent-switch effect ordering", () => {
  it("BUG: a useEffect reset wipes the child's cache-hit hydrate (blank message area)", async () => {
    const store = createStore();
    createStoreRef.current = store;
    // Pre-seed react-query so the SECOND agent is a CACHE HIT (no suspend),
    // mirroring a fast switch within staleTime.
    vi.mocked(fetchHistory).mockResolvedValue({
      items: [aiMessage("100", "agent 3 history")],
      hasNext: false,
    });

    const { rerender } = render(
      <CollaborationProbe agentInstanceId={5} resetVariant="effect" />,
      { wrapper: wrapper(store) },
    );
    // Let agent 5 settle + hydrate.
    await screen.findByTestId("history-ready");
    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history.length).toBeGreaterThan(
        0,
      ),
    );

    // Switch to agent 3 — but agent 3's queryKey is new, so it would suspend.
    // Re-point the mock so agent 3 also resolves to a cache the moment it's
    // requested. To force the CACHE-HIT (no-suspend) path deterministically, we
    // switch BACK to agent 5 (already cached) — the real-world A→B→A fast switch.
    rerender(<CollaborationProbe agentInstanceId={3} resetVariant="effect" />);
    await screen.findByTestId("history-ready");
    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history.length).toBeGreaterThan(
        0,
      ),
    );

    // Fast switch BACK to agent 5 (cache hit → no suspend → the race).
    rerender(<CollaborationProbe agentInstanceId={5} resetVariant="effect" />);
    await screen.findByTestId("history-ready");

    // BUG: with a plain useEffect reset, the child hydrate ran first and the
    // parent reset wiped it → blank.
    await waitFor(() => {
      expect(store.get(activeConversationAtom)?.history ?? []).toHaveLength(0);
    });
  });

  it("FIX: a useLayoutEffect reset runs before the child hydrate (history survives)", async () => {
    const store = createStore();
    createStoreRef.current = store;
    vi.mocked(fetchHistory).mockResolvedValue({
      items: [aiMessage("100", "agent history")],
      hasNext: false,
    });

    const { rerender } = render(
      <CollaborationProbe agentInstanceId={5} resetVariant="layout" />,
      { wrapper: wrapper(store) },
    );
    await screen.findByTestId("history-ready");
    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history.length).toBeGreaterThan(
        0,
      ),
    );

    rerender(<CollaborationProbe agentInstanceId={3} resetVariant="layout" />);
    await screen.findByTestId("history-ready");
    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history.length).toBeGreaterThan(
        0,
      ),
    );

    // Fast switch back to the cached agent 5.
    rerender(<CollaborationProbe agentInstanceId={5} resetVariant="layout" />);
    await screen.findByTestId("history-ready");

    // FIX: history is present after the switch (reset ran in layout phase,
    // before the child's passive hydrate).
    await waitFor(() => {
      expect(store.get(activeConversationAtom)?.history.length).toBeGreaterThan(
        0,
      );
    });
  });
});
