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
import { act, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Collaboration } from "@/features/chat";
import {
  sidepaneContentAtom,
  sidepaneMaximizedAtom,
} from "@/features/chat/atoms/sidepane-atom";
import { useHistory, type UseHistory } from "@/features/chat/hooks/use-history";
import { useReconnect } from "@/features/chat/hooks/use-reconnect";

// Harness mirrors collaboration.test.tsx: Collaboration mounts the Composer
// (reads useChat) — stub the transport so it mounts without a real store/SSE.
vi.mock("@/features/chat/hooks/use-chat", () => ({
  useChat: () => ({ send: vi.fn(), stop: vi.fn(), upload: vi.fn() }),
}));

// A mounted plan card owns a /plan poll; stub the network boundary so the tree
// never hits the stub axios client.
vi.mock("@/features/chat/services/plan", async (importActual) => {
  const actual =
    await importActual<typeof import("@/features/chat/services/plan")>();
  return { ...actual, fetchPlan: vi.fn() };
});

// A turn's ExperiencePill calls useNavigate; this suite renders outside a
// RouterProvider, so stub the hook to keep the tree mountable + warning-free.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// use-history carries its own suite; stub it so Collaboration mounts without a
// real history fetch (it only needs the pager shape).
vi.mock("@/features/chat/hooks/use-history", () => ({
  useHistory: vi.fn(),
}));

// use-reconnect carries its own suite; stub it so Collaboration mounts without
// firing a real reconnect probe (it only needs a stop handle).
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

beforeEach(() => {
  vi.clearAllMocks();
  // MessageList mounts an IntersectionObserver-backed pager sentinel jsdom does
  // not provide — stub it (this suite only cares that the row composes).
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
  // Collaboration reads useQueryClient (to invalidate history on reconnect
  // settle), so a QueryClient must back the tree even though useReconnect /
  // useHistory are mocked here.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <JotaiProvider store={store}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </JotaiProvider>
    );
  }

  return Wrapper;
}

describe("Collaboration + Sidepane (inline push)", () => {
  // Closed (default content=null): the chat column renders and the Sidepane is
  // absent, so the chat fills the row — no regression from today.
  it("renders the chat without a Sidepane when content is null", () => {
    const store = createStore();
    render(<Collaboration agentInstanceId={1} />, {
      wrapper: withStore(store),
    });

    expect(screen.getByLabelText("Message input")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Preview panel" }),
    ).not.toBeInTheDocument();
  });

  // Open (MP1): the Sidepane mounts as a SIBLING of the chat column — both
  // coexist (the chat is pushed, not replaced). The agent-switch reset closes
  // the pane (incl. on the first-mount edge), so the content is seeded AFTER
  // mount via `act` — mirroring production, where the pane is only ever opened
  // by a user click inside an already-mounted Collaboration.
  it("mounts the Sidepane beside the chat when content is set (MP1)", () => {
    const store = createStore();
    render(<Collaboration agentInstanceId={1} />, {
      wrapper: withStore(store),
    });
    act(() => {
      store.set(sidepaneContentAtom, {
        kind: "markdown",
        title: "T",
        markdown: "# B",
      });
    });

    expect(
      screen.getByRole("region", { name: "Preview panel" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message input")).toBeInTheDocument();
  });

  // State bleed: a Sidepane preview is a copy of the prior agent's deliverable,
  // so switching agents (param-only, no remount) must close it alongside the
  // plans/conversations the reset effect already clears — else agent A's preview
  // hangs over agent B's freshly-cleared chat. The shell now animates shut (it
  // does not unmount), so "closed" = the atoms are cleared AND the shell has
  // collapsed to `w-0`; the previewer lingers only for the slide-out.
  it("closes the Sidepane when the agent switches (no cross-agent bleed)", () => {
    const store = createStore();
    const { rerender } = render(<Collaboration agentInstanceId={1} />, {
      wrapper: withStore(store),
    });
    act(() => {
      store.set(sidepaneContentAtom, {
        kind: "markdown",
        title: "Agent A report",
        markdown: "# A",
      });
      store.set(sidepaneMaximizedAtom, true);
    });
    expect(
      screen.getByRole("region", { name: "Preview panel" }),
    ).toBeInTheDocument();

    // Param-only switch to a different agent.
    rerender(<Collaboration agentInstanceId={2} />);

    expect(screen.getByTestId("sidepane-shell")).toHaveClass("w-0");
    expect(store.get(sidepaneContentAtom)).toBeNull();
    expect(store.get(sidepaneMaximizedAtom)).toBe(false);
  });
});
