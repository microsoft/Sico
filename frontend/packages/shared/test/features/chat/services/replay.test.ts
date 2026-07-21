import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Conversation,
  conversationsAtom,
  type Message,
} from "@/features/chat/atoms/chat-atom";
import { type ChatEvent } from "@/features/chat/schemas/chat-event";
import { createOnReplay, settleTurn } from "@/features/chat/services/replay";

// A MARKDOWN message frame carrying the (optional) turnId — the shape reconnect
// replay accumulates from head.
function messageFrame(content: string, turnId?: number): ChatEvent {
  return {
    event: "message",
    data:
      turnId === undefined
        ? { type: 1, content }
        : { type: 1, content, turnId },
  };
}

// Seed a store with one conversation whose single AI message carries `turnId`.
function storeWithTurn(
  turnId: number,
  messageId = "ai",
): {
  store: ReturnType<typeof createStore>;
  clientId: string;
} {
  const store = createStore();
  const clientId = "c1";
  const message: Message = {
    id: messageId,
    author: "ai",
    turnId,
    content: [],
  };
  const conv: Conversation = { clientId, history: [message] };
  store.set(conversationsAtom, new Map([[clientId, conv]]));
  return { store, clientId };
}

// Read the joined text of a message's text parts (precedent: frame-reducer.test).
function joinText(
  store: ReturnType<typeof createStore>,
  clientId: string,
  messageId: string,
): string {
  const msg = store
    .get(conversationsAtom)
    .get(clientId)
    ?.history.find((m) => m.id === messageId);
  return (msg?.content ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

// Drive rAF manually: each call queues a callback the test flushes on demand,
// so coalescing (many calls → one flush) is observable without wall time.
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function flushRaf(): void {
  const queued = rafQueue;
  rafQueue = [];
  for (const cb of queued) {
    cb(0);
  }
}

describe("createOnReplay", () => {
  it("writes the from-head buffer into the message matched by turnId", () => {
    const { store, clientId } = storeWithTurn(42);
    const { onReplay } = createOnReplay(store);

    onReplay([messageFrame("Hello", 42), messageFrame(" world", 42)]);
    flushRaf();

    expect(joinText(store, clientId, "ai")).toBe("Hello world");
  });

  it("targets the AI message, not the human one, when both share a turnId", () => {
    // A turn has BOTH a human and an ai message sharing the turnId, human first.
    // Replay must write the resumed reply onto the AI row (an author-agnostic
    // match would hit the human row, mangling it with reply content).
    const store = createStore();
    const clientId = "c1";
    const conv: Conversation = {
      clientId,
      history: [
        { id: "human-1", author: "human", turnId: 7, content: [] },
        { id: "ai-1", author: "ai", turnId: 7, content: [] },
      ],
    };
    store.set(conversationsAtom, new Map([[clientId, conv]]));
    const { onReplay } = createOnReplay(store);

    onReplay([messageFrame("resumed reply", 7)]);
    flushRaf();

    expect(joinText(store, clientId, "ai-1")).toBe("resumed reply");
    // The human row is untouched.
    expect(joinText(store, clientId, "human-1")).toBe("");
  });

  it("coalesces rapid calls into one apply carrying the LATEST buffer", () => {
    const { store, clientId } = storeWithTurn(42);
    const { onReplay } = createOnReplay(store);
    const setSpy = vi.spyOn(store, "set");

    // Three calls before any rAF flush — only the last buffer should win.
    onReplay([messageFrame("a", 42)]);
    onReplay([messageFrame("a", 42), messageFrame("b", 42)]);
    onReplay([
      messageFrame("a", 42),
      messageFrame("b", 42),
      messageFrame("c", 42),
    ]);
    // Exactly one rAF was scheduled (the 2nd/3rd calls are no-ops while pending).
    expect(rafQueue).toHaveLength(1);

    flushRaf();

    // One store write, carrying the full from-head run (reset-then-replay).
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(joinText(store, clientId, "ai")).toBe("abc");
  });

  it("reset-then-replay rebuilds from head — a longer run over a partial tail does not double-append", () => {
    const { store, clientId } = storeWithTurn(42);
    // Pre-seed a partial tail on the message (as if a few frames already landed).
    store.set(
      conversationsAtom,
      new Map([
        [
          clientId,
          {
            clientId,
            history: [
              {
                id: "ai",
                author: "ai" as const,
                turnId: 42,
                content: [{ partId: "x", type: "text" as const, text: "He" }],
              },
            ],
          },
        ],
      ]),
    );
    const { onReplay } = createOnReplay(store);

    onReplay([messageFrame("He", 42), messageFrame("llo", 42)]);
    flushRaf();

    expect(joinText(store, clientId, "ai")).toBe("Hello");
  });

  it("is a no-op when the buffer carries no turnId (e.g. keepalive-only run)", () => {
    const { store, clientId } = storeWithTurn(42);
    const setSpy = vi.spyOn(store, "set");
    const { onReplay } = createOnReplay(store);

    onReplay([messageFrame("orphan")]); // no turnId
    flushRaf();

    expect(setSpy).not.toHaveBeenCalled();
    expect(joinText(store, clientId, "ai")).toBe("");
  });

  it("creates an AI row to receive the replay when the turn has only a human row (mid-stream reload)", () => {
    // Reloading mid-stream: the AI reply never persisted, so history hydrates
    // ONLY the human row for that turn. The reconnect replays the turn from head,
    // but there's no AI message to write into. Rather than drop the resumed
    // reply, replay must MINT an AI row paired to the human turn (mirrors
    // legacy's always-present empty agent section).
    const store = createStore();
    const clientId = "c1";
    const conv: Conversation = {
      clientId,
      history: [{ id: "human-1", author: "human", turnId: 7, content: [] }],
    };
    store.set(conversationsAtom, new Map([[clientId, conv]]));
    const { onReplay } = createOnReplay(store);

    onReplay([messageFrame("resumed after reload", 7)]);
    flushRaf();

    const history = store.get(conversationsAtom).get(clientId)?.history ?? [];
    const ai = history.find((m) => m.author === "ai" && m.turnId === 7);
    // A fresh AI row now exists, carrying the resumed reply, ordered AFTER its
    // human turn.
    expect(ai).toBeDefined();
    expect(joinText(store, clientId, ai!.id)).toBe("resumed after reload");
    expect(ai?.streamingState).toBe("streaming");
    expect(
      history.indexOf(history.find((m) => m.id === "human-1")!),
    ).toBeLessThan(history.indexOf(ai!));
    // The human row is untouched.
    expect(joinText(store, clientId, "human-1")).toBe("");
  });

  it("buffers a replay that races ahead of history, then flushes it on hydration (issue #191)", () => {
    // The store has turn 42, but the replay is for turn 99 — its message hasn't
    // hydrated yet (reconnect won the race against history). The run must be
    // BUFFERED, not dropped, then applied once turn 99 appears.
    const { store } = storeWithTurn(42);
    const { onReplay } = createOnReplay(store);

    onReplay([messageFrame("resumed content", 99)]);
    flushRaf();

    // Nothing applied yet — turn 99 isn't in history.
    expect(joinText(store, "c1", "ai")).toBe("");

    // History hydrates: turn 99 arrives as a new conversation/message.
    store.set(
      conversationsAtom,
      new Map([
        [
          "c99",
          {
            clientId: "c99",
            history: [
              { id: "m99", author: "ai" as const, turnId: 99, content: [] },
            ],
          },
        ],
      ]),
    );

    // The buffered run flushed into turn 99 on the hydration store-change.
    expect(joinText(store, "c99", "m99")).toBe("resumed content");
  });

  it("mints exactly ONE ai row when a buffered replay later resolves to a human-only turn", () => {
    // Composes the #191 race WITH the mint path: the replay arrives before ANY
    // row for its turn (buffers), then history hydrates the turn as human-only
    // (mid-stream reload). `createAiRowForTurn` calls `store.set`, which notifies
    // the same `conversationsAtom` subscription that drives `attempt` — a naive
    // implementation would re-enter and mint a SECOND ai row. Exactly one must
    // exist.
    const { store } = storeWithTurn(42); // unrelated existing turn
    const { onReplay } = createOnReplay(store);

    onReplay([messageFrame("resumed", 99)]); // no row for 99 yet → buffers
    flushRaf();

    // History hydrates turn 99 as a human-only row (the reloaded streaming turn).
    store.set(
      conversationsAtom,
      new Map([
        ...store.get(conversationsAtom),
        [
          "c99",
          {
            clientId: "c99",
            history: [
              {
                id: "human-99",
                author: "human" as const,
                turnId: 99,
                content: [],
              },
            ],
          },
        ],
      ]),
    );

    const aiRows = (
      store.get(conversationsAtom).get("c99")?.history ?? []
    ).filter((m) => m.author === "ai" && m.turnId === 99);
    expect(aiRows).toHaveLength(1);
    expect(joinText(store, "c99", aiRows[0]!.id)).toBe("resumed");
  });

  it("dispose() tears down a pending hydration subscription (no late flush)", () => {
    const { store } = storeWithTurn(42);
    const { onReplay, dispose } = createOnReplay(store);

    onReplay([messageFrame("resumed", 99)]); // races ahead → buffered
    flushRaf();
    dispose();

    // After dispose, a late hydration must NOT trigger a flush.
    const setSpy = vi.spyOn(store, "set");
    store.set(
      conversationsAtom,
      new Map([
        [
          "c99",
          {
            clientId: "c99",
            history: [
              { id: "m99", author: "ai" as const, turnId: 99, content: [] },
            ],
          },
        ],
      ]),
    );
    // The only set is the test's own hydration — no replay write followed it.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(joinText(store, "c99", "m99")).toBe("");
  });

  it("re-arms after a flush — a later call schedules a fresh rAF", () => {
    const { store, clientId } = storeWithTurn(42);
    const { onReplay } = createOnReplay(store);

    onReplay([messageFrame("first", 42)]);
    flushRaf();
    expect(joinText(store, clientId, "ai")).toBe("first");

    // A second episode schedules a new frame and applies independently.
    onReplay([messageFrame("first", 42), messageFrame("-second", 42)]);
    expect(rafQueue).toHaveLength(1);
    flushRaf();
    expect(joinText(store, clientId, "ai")).toBe("first-second");
  });

  // C1 race: a data frame defers its store write to a rAF, but the terminal
  // `done`/`error` settle runs synchronously. When the terminal frame lands
  // within the same animation frame as the last content frame (the normal SSE
  // end-of-turn burst), the still-pending replay rAF fires AFTER settle and must
  // NOT revert the turn from its terminal state back to `streaming` — else the
  // resumed turn is stuck streaming and the composer stays locked on Stop.
  it("a pending replay rAF does not revert a turn that settle already marked done", () => {
    const { store, clientId } = storeWithTurn(42);
    const { onReplay } = createOnReplay(store);

    // Last content frame: schedules a rAF, NOT yet applied.
    onReplay([messageFrame("final answer", 42)]);
    expect(rafQueue).toHaveLength(1);

    // Terminal `done` settles synchronously (the machine's `settle` command),
    // before the replay rAF fires.
    settleTurn(store, 42, "done");

    // The deferred replay rAF now fires.
    flushRaf();

    const msg = store
      .get(conversationsAtom)
      .get(clientId)
      ?.history.find((m) => m.id === "ai");
    // Content still rebuilt from the run…
    expect(joinText(store, clientId, "ai")).toBe("final answer");
    // …but the terminal state survives the late replay.
    expect(msg?.streamingState).toBe("done");
  });
});
