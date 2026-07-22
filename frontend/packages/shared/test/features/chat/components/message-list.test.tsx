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
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { produce } from "immer";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeConversationIdAtom,
  conversationsAtom,
  type Message,
} from "@/features/chat/atoms/chat-atom";
import { MessageList } from "@/features/chat/components/message-list";
import { ChatAgentProvider } from "@/features/chat/services/chat-agent-context";
import type { Agent } from "@/features/digital-worker";
import { ApiClientProvider } from "@/services/api-client-context";

// Spy injected into the AgentCard stub: counts AI-row renders so the
// streaming-tail memo test can prove a settled row bails out while the tail
// streams (§6.E7a per-row memo).
const agentRenderSpy = vi.fn();

// `MessageCard` → `ExperiencePill` calls `useNavigate` for its `View more` jump;
// this suite renders outside a RouterProvider, so stub the router hook to keep
// the tree mountable and the output warning-free.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Stub the three routed leaf cards so this suite exercises the LIST's job —
// row mapping, stable keys, the reverse-pagination sentinel, scroll wiring — in
// isolation from each card's internals (those have their own suites). The real
// `MessageCard` dispatch memo stays unmocked so its boundary is exercised here.
vi.mock("@/features/chat/components/cards/user-card", () => ({
  UserCard: ({ text }: { text: string }): ReactElement => (
    <div data-testid="user-card">{text}</div>
  ),
}));
vi.mock("@/features/chat/components/cards/agent-card", () => ({
  AgentCard: ({ text }: { text: string }): ReactElement => {
    agentRenderSpy();
    return <div data-testid="agent-card">{text}</div>;
  },
}));
vi.mock("@/features/chat/components/cards/plan-card", () => ({
  PlanCard: ({ planId }: { planId: string }): ReactElement => (
    <div data-testid="plan-card">{planId}</div>
  ),
}));
// Stay-at-bottom is the library's job (use-stick-to-bottom, unit-tested
// upstream); here we mock it so the LIST's wiring is exercised in isolation. The
// `scrollRef` is a real RefObject+callback so the sentinel test can assert the
// IntersectionObserver root is exactly the scroll container node, and the
// affordance test can drive `isAtBottom`.
const scrollToBottomSpy = vi.fn();
const stickState = { isAtBottom: true };

// The library returns a combined RefCallback+RefObject whose `.current` is live.
// Model that: a callback fn that writes its OWN `.current` when React attaches.
function makeStickRef(): ((node: HTMLElement | null) => void) & {
  current: HTMLElement | null;
} {
  const cb = (node: HTMLElement | null): void => {
    cb.current = node;
  };
  cb.current = null as HTMLElement | null;
  return cb as typeof cb & { current: HTMLElement | null };
}

const stickScrollRef = makeStickRef();
const stickContentRef = makeStickRef();
vi.mock("use-stick-to-bottom", () => ({
  useStickToBottom: () => ({
    scrollRef: stickScrollRef,
    contentRef: stickContentRef,
    isAtBottom: stickState.isAtBottom,
    scrollToBottom: scrollToBottomSpy,
    stopScroll: vi.fn(),
  }),
}));
// Prepend position-preservation has its own unit suite (the anchor/re-pin math
// needs real layout); here mock it to a capture spy so we can assert the list
// captures the reading position when the sentinel fires an older-page fetch.
const captureSpy = vi.fn();
vi.mock("@/features/chat/hooks/use-anchor-scroll-on-prepend", () => ({
  useAnchorScrollOnPrepend: () => captureSpy,
}));
// The top-anchor math needs real layout, so it has its own unit suite; here mock
// it to a spy that records its args, so we can assert the list feeds it the
// correct latest-human id (tail scan) and `enabled` gate.
const scrollNewHumanToTopSpy = vi.fn();
vi.mock("@/features/chat/hooks/use-scroll-new-human-to-top", () => ({
  useScrollNewHumanToTop: (...args: unknown[]) =>
    scrollNewHumanToTopSpy(...args),
}));

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

let ioInstances: {
  callback: IOCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  root: IntersectionObserverInit["root"];
}[];

beforeEach(() => {
  ioInstances = [];
  agentRenderSpy.mockClear();
  scrollToBottomSpy.mockClear();
  captureSpy.mockClear();
  scrollNewHumanToTopSpy.mockClear();
  stickState.isAtBottom = true;
  stickScrollRef.current = null;
  stickContentRef.current = null;
  class MockIO {
    callback: IOCallback;
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    root: IntersectionObserverInit["root"] = null;
    rootMargin = "";
    thresholds: readonly number[] = [];
    constructor(cb: IOCallback, options?: IntersectionObserverInit) {
      this.callback = cb;
      this.root = options?.root ?? null;
      ioInstances.push({
        callback: cb,
        observe: this.observe,
        disconnect: this.disconnect,
        root: options?.root ?? null,
      });
    }
  }
  Object.defineProperty(global, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: MockIO,
  });
  Object.defineProperty(window, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: MockIO,
  });
});

const LIST_AGENT_ID = 601;
const seededAgent: Agent = {
  id: LIST_AGENT_ID,
  name: "Max",
  project: { id: 84, name: "SICO" },
};

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["agents", "detail", LIST_AGENT_ID], seededAgent);

  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <JotaiProvider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={{} as AxiosInstance}>
            <ChatAgentProvider
              agentInstanceId={LIST_AGENT_ID}
              conversationId={1}
            >
              {children}
            </ChatAgentProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </JotaiProvider>
    );
  }

  return Wrapper;
}

// Make the scroll node report real content below the fold so the geometry gate
// (scrollHeight − scrollTop − clientHeight − reserve > 8) lets the button show.
function withContentBelow(el: HTMLElement | null): void {
  if (!el) {
    return;
  }
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => 2000,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => 0 });
}

const human = (id: string, text: string): Message => ({
  id,
  author: "human",
  content: [{ partId: `${id}-p`, type: "text", text }],
});

const aiText = (id: string, text: string, streaming = false): Message => ({
  id,
  author: "ai",
  streamingState: streaming ? "streaming" : "done",
  content: [{ partId: `${id}-p`, type: "text", text }],
});

function seed(store: ReturnType<typeof createStore>, history: Message[]): void {
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (m) => {
      m.set("c1", { clientId: "c1", history });
    }),
  );
  store.set(activeConversationIdAtom, "c1");
}

describe("MessageList", () => {
  it("renders one MessageCard row per history message, oldest→newest", () => {
    const store = createStore();
    seed(store, [human("h", "ping"), aiText("a", "pong")]);
    const { container } = render(<MessageList />, {
      wrapper: withStore(store),
    });
    // MessageCard's root carries `data-author`; one per message.
    expect(container.querySelectorAll("[data-author]")).toHaveLength(2);
    expect(screen.getByTestId("user-card")).toHaveTextContent("ping");
    expect(screen.getByTestId("agent-card")).toHaveTextContent("pong");
    // Human turn (oldest) precedes the AI turn (newest) in the DOM.
    const html = container.innerHTML;
    expect(html.indexOf('data-testid="user-card"')).toBeLessThan(
      html.indexOf('data-testid="agent-card"'),
    );
  });

  it("wires the stick-to-bottom refs to the scroll container and content node", () => {
    const store = createStore();
    seed(store, [human("h", "a"), aiText("a", "b")]);
    render(<MessageList />, { wrapper: withStore(store) });
    // Both refs received a real element — the scroll container and the inner
    // content div the library observes. A null would mean an unwired ref,
    // defeating stick-to-bottom.
    expect(stickScrollRef.current).toBeInstanceOf(HTMLElement);
    expect(stickContentRef.current).toBeInstanceOf(HTMLElement);
  });

  it("points the sentinel observer at the stick-to-bottom scroll container", () => {
    // The scroll container is shared: stick-to-bottom + the sentinel observer act
    // on ONE node. The library's scrollRef is the sentinel's root, so assert the
    // IO root is that node.
    const store = createStore();
    seed(store, [aiText("a", "newest")]);
    render(<MessageList hasMore fetchOlder={vi.fn()} />, {
      wrapper: withStore(store),
    });
    expect(stickScrollRef.current).not.toBeNull();
    expect(ioInstances.at(-1)?.root).toBe(stickScrollRef.current);
  });

  it("renders the scroll-to-bottom button only when NOT at the bottom", () => {
    const store = createStore();
    seed(store, [aiText("a", "newest")]);

    stickState.isAtBottom = true;
    const { rerender } = render(<MessageList />, { wrapper: withStore(store) });
    expect(
      screen.queryByRole("button", { name: /scroll to newest/i }),
    ).not.toBeInTheDocument();

    stickState.isAtBottom = false;
    withContentBelow(stickScrollRef.current);
    rerender(<MessageList />);
    expect(
      screen.getByRole("button", { name: /scroll to newest/i }),
    ).toBeInTheDocument();
  });

  it("calls scrollToBottom when the affordance is clicked", async () => {
    const store = createStore();
    seed(store, [aiText("a", "newest")]);
    stickState.isAtBottom = false;
    const { rerender } = render(<MessageList />, { wrapper: withStore(store) });
    withContentBelow(stickScrollRef.current);
    rerender(<MessageList />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /scroll to newest/i }));

    expect(scrollToBottomSpy).toHaveBeenCalledTimes(1);
  });

  it("triggers fetchOlder when the top sentinel scrolls into view and hasMore", () => {
    const store = createStore();
    seed(store, [aiText("a", "newest")]);
    const fetchOlder = vi.fn();
    // The user has scrolled up toward the top sentinel → not at the bottom.
    stickState.isAtBottom = false;
    render(<MessageList hasMore fetchOlder={fetchOlder} />, {
      wrapper: withStore(store),
    });
    expect(ioInstances.length).toBeGreaterThan(0);
    const io = ioInstances[ioInstances.length - 1]!;
    act(() => {
      io.callback([
        {
          isIntersecting: true,
        } as Partial<IntersectionObserverEntry> as IntersectionObserverEntry,
      ]);
    });
    expect(fetchOlder).toHaveBeenCalledTimes(1);
  });

  it("does NOT fetch older when the sentinel fires while pinned to the bottom (cold-load artifact)", () => {
    // On first load the list is pinned to the bottom, yet the top sentinel still
    // sits inside its 200px prefetch band and fires once. Fetching then would
    // auto-load a second page the user never scrolled for — so an at-bottom
    // intersection must be ignored.
    const store = createStore();
    seed(store, [aiText("a", "newest")]);
    const fetchOlder = vi.fn();
    stickState.isAtBottom = true;
    render(<MessageList hasMore fetchOlder={fetchOlder} />, {
      wrapper: withStore(store),
    });
    const io = ioInstances.at(-1)!;
    act(() => {
      io.callback([
        {
          isIntersecting: true,
        } as Partial<IntersectionObserverEntry> as IntersectionObserverEntry,
      ]);
    });
    expect(fetchOlder).not.toHaveBeenCalled();
  });

  it("captures the reading position before fetching an older page", () => {
    // Reverse pagination at the TOP edge: before the older page prepends, the
    // list must snapshot the reading row so the anchor hook can re-pin it after
    // the DOM grows. Assert the capture runs as part of the sentinel-driven
    // fetch (the anchor math itself is covered in the hook's own suite).
    const store = createStore();
    seed(store, [aiText("old", "older"), aiText("new", "newest")]);
    const fetchOlder = vi.fn();
    stickState.isAtBottom = false; // scrolled up to load older
    render(<MessageList hasMore fetchOlder={fetchOlder} />, {
      wrapper: withStore(store),
    });

    const io = ioInstances.at(-1)!;
    act(() => {
      io.callback([
        {
          isIntersecting: true,
        } as Partial<IntersectionObserverEntry> as IntersectionObserverEntry,
      ]);
    });

    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(fetchOlder).toHaveBeenCalledTimes(1);
  });

  it("feeds the top-anchor hook the latest HUMAN message id (tail scan)", () => {
    // The anchor pins the newest user message; the list must pick the last
    // `author==="human"` row, NOT the last row overall (which is the AI reply).
    const store = createStore();
    seed(store, [
      human("h1", "first question"),
      aiText("a1", "first answer"),
      human("h2", "second question"),
      aiText("a2", "streaming…", true),
    ]);
    render(<MessageList />, { wrapper: withStore(store) });

    const args = scrollNewHumanToTopSpy.mock.calls.at(-1)!;
    // (refs, latestHumanId, opts) — assert the 2nd arg.
    expect(args[1]).toBe("h2");
  });

  it("does not anchor when the conversation has no human message", () => {
    // A history of only AI rows (e.g. a replayed turn) has no anchor target, so
    // the latest-human id is undefined and the hook is a no-op.
    const store = createStore();
    seed(store, [aiText("a", "newest")]);
    render(<MessageList />, { wrapper: withStore(store) });

    const args = scrollNewHumanToTopSpy.mock.calls.at(-1)!;
    expect(args[1]).toBeUndefined();
  });

  it("observes the sentinel after hasMore flips false→true on cold load", () => {
    // Cold load: the first history page hasn't resolved, so the pager reports
    // hasMore=false; once it resolves, hasMore flips on. The sentinel must be
    // mounted (and observed) the whole time — the observer effect is keyed on
    // the stable sentinelRef and runs once, so gating the sentinel on hasMore
    // would leave it unobserved when the flip arrives and silently kill
    // scroll-to-top pagination on the common first-visit path.
    const store = createStore();
    seed(store, [aiText("a", "newest")]);
    const fetchOlder = vi.fn();
    stickState.isAtBottom = false; // scrolled up to the top sentinel
    const { rerender } = render(
      <MessageList hasMore={false} fetchOlder={fetchOlder} />,
      { wrapper: withStore(store) },
    );
    rerender(<MessageList hasMore fetchOlder={fetchOlder} />);

    expect(ioInstances.length).toBeGreaterThan(0);
    const io = ioInstances[ioInstances.length - 1]!;
    act(() => {
      io.callback([
        {
          isIntersecting: true,
        } as Partial<IntersectionObserverEntry> as IntersectionObserverEntry,
      ]);
    });
    expect(fetchOlder).toHaveBeenCalledTimes(1);
  });

  it("observes the sentinel against its bounded scroll container, not the viewport", () => {
    // The list scrolls inside a local `overflow-y-auto` container, so the
    // sentinel's IntersectionObserver must use THAT container as its root.
    // Otherwise `rootMargin`'s 200px prefetch lead is measured from the
    // viewport and never applies — older pages would load only once the user
    // hit the container's hard top edge. The container is the stick-to-bottom
    // scrollRef node, so assert the observer's root is exactly it.
    const store = createStore();
    seed(store, [aiText("a", "newest")]);
    render(<MessageList hasMore fetchOlder={vi.fn()} />, {
      wrapper: withStore(store),
    });
    const scrollContainer = stickScrollRef.current;
    expect(scrollContainer).not.toBeNull();
    expect(ioInstances.at(-1)?.root).toBe(scrollContainer);
  });

  it("does NOT paginate when hasMore is false even if the sentinel intersects", () => {
    const store = createStore();
    seed(store, [aiText("a", "only")]);
    const fetchOlder = vi.fn();
    render(<MessageList hasMore={false} fetchOlder={fetchOlder} />, {
      wrapper: withStore(store),
    });
    // The sentinel mounts unconditionally so the observer is ready for a later
    // hasMore flip; the hook guards on hasNextPage, so an intersection while
    // hasMore is false must NOT fetch.
    const io = ioInstances.at(-1);
    act(() => {
      io?.callback([
        {
          isIntersecting: true,
        } as Partial<IntersectionObserverEntry> as IntersectionObserverEntry,
      ]);
    });
    expect(fetchOlder).not.toHaveBeenCalled();
  });

  it("re-renders ONLY the streaming tail when settled rows keep their ref (memo)", () => {
    const store = createStore();
    seed(store, [aiText("settled", "done body"), aiText("tail", "live", true)]);
    render(<MessageList />, { wrapper: withStore(store) });
    const afterFirst = agentRenderSpy.mock.calls.length;

    // Immer structural sharing: mutate ONLY the tail's text. The settled row
    // keeps its object identity, so its memoized MessageCard must bail out.
    act(() => {
      store.set(
        conversationsAtom,
        produce(store.get(conversationsAtom), (m) => {
          const conv = m.get("c1");
          const tail = conv?.history[1];
          if (tail?.content[0]?.type === "text") {
            tail.content[0].text = "live more";
          }
        }),
      );
    });
    const afterSecond = agentRenderSpy.mock.calls.length;

    // Only the tail re-rendered → exactly one additional AgentCard render.
    expect(afterSecond - afterFirst).toBe(1);
    expect(screen.getByText("live more")).toBeInTheDocument();
  });

  it("renders no rows for an empty conversation", () => {
    const store = createStore();
    const { container } = render(<MessageList />, {
      wrapper: withStore(store),
    });
    expect(container.querySelectorAll("[data-author]")).toHaveLength(0);
  });

  it("carries content as escaped text — never dangerouslySetInnerHTML (ISSUE-001)", () => {
    const store = createStore();
    seed(store, [aiText("a", "<img src=x onerror=alert(1)>")]);
    const { container } = render(<MessageList />, {
      wrapper: withStore(store),
    });
    expect(
      screen.getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
