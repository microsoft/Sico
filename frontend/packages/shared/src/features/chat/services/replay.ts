import { produce } from "immer";
import { type createStore } from "jotai";

import { replayFrames } from "./frame-reducer";
import { makeId } from "../../../utils/id";
import {
  activeConversationIdAtom,
  conversationsAtom,
  type Message,
  type TerminalStreamingState,
} from "../atoms/chat-atom";
import { type ChatEvent } from "../schemas/chat-event";

type Store = ReturnType<typeof createStore>;

export type OnReplay = {
  onReplay: (events: ChatEvent[]) => void;
  // Reconnect stream opened: mint a `streaming` AI placeholder so the resumed
  // turn shows Thinking… immediately — it resumes a stream that already opened,
  // so it's past the `pending` (spinner) state. No-op unless the active
  // conversation looks like it has an unanswered in-flight turn (see
  // `mintThinkingPlaceholder`).
  onOpen: () => void;
  // Reconnect stream ended: drop a placeholder that was never claimed by a frame
  // (e.g. an already-done turn's empty reconnect), so no stuck Thinking… lingers.
  onStreamEnd: () => void;
  // Tears down the rAF + any pending hydration subscription (called on unmount).
  dispose: () => void;
};

// First message frame carrying a turnId wins (matches chat.ts's capture-once).
function extractTurnId(events: ChatEvent[]): number | undefined {
  for (const event of events) {
    if (event.event === "message" && event.data.turnId !== undefined) {
      return event.data.turnId;
    }
  }
  return undefined;
}

function findMessageByTurnId(
  store: Store,
  turnId: number,
): { clientId: string; messageId: string } | undefined {
  const conversations = store.get(conversationsAtom);
  for (const conv of conversations.values()) {
    // Only the AI reply is resumed — a turn has BOTH a human and an ai message
    // sharing the turnId, and the human row comes first, so an author-agnostic
    // `find` would target the human message (writing reply content + a bogus
    // streaming state onto it).
    const message = conv.history.find(
      (m) => m.turnId === turnId && m.author === "ai",
    );
    if (message) {
      return { clientId: conv.clientId, messageId: message.id };
    }
  }
  return undefined;
}

// Mid-stream reload recovery: the resumed turn's AI reply never persisted, so
// history hydrates ONLY the human row for it — `findMessageByTurnId` finds no AI
// target. When a human row for the turn DOES exist, mint a fresh AI row right
// after it (seeded `streaming`, since the turn is being resumed live) and return
// its location so the replay writes into it. Returns undefined when no human row
// carries the turnId either — that's the #191 hydration race (nothing for this
// turn yet), which must keep buffering, NOT mint a stray row. Mirrors legacy's
// always-present empty agent section per turn.
function createAiRowForTurn(
  store: Store,
  turnId: number,
): { clientId: string; messageId: string } | undefined {
  const conversations = store.get(conversationsAtom);
  for (const conv of conversations.values()) {
    const humanIndex = conv.history.findIndex(
      (m) => m.turnId === turnId && m.author === "human",
    );
    if (humanIndex === -1) {
      continue;
    }
    const aiMessage: Message = {
      id: makeId(),
      author: "ai",
      turnId,
      content: [],
      streamingState: "streaming",
    };
    store.set(
      conversationsAtom,
      produce(conversations, (draft) => {
        const target = draft.get(conv.clientId);
        // Insert directly after the human row so render order stays human→ai.
        target?.history.splice(humanIndex + 1, 0, aiMessage);
      }),
    );
    return { clientId: conv.clientId, messageId: aiMessage.id };
  }
  return undefined;
}

// Settle a reconnect-resumed turn's AI message to a terminal streaming state.
// Driven by the reconnect machine's terminal events (a `done` frame or user
// `stop`) via the `settle` command — the live-send path settles in the
// `sendMessage` closure, but a turn resumed after a mid-stream reload has no
// such closure, so its terminal state is event-driven from here instead. A
// no-op when the turn isn't found (already gone / not hydrated).
export function settleTurn(
  store: Store,
  turnId: number,
  state: TerminalStreamingState,
): void {
  const target = findMessageByTurnId(store, turnId);
  if (target === undefined) {
    return;
  }
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (draft) => {
      const msg = draft
        .get(target.clientId)
        ?.history.find((m) => m.id === target.messageId);
      if (msg) {
        msg.streamingState = state;
      }
    }),
  );
}

// reset-then-replay: the full from-head run rebuilds the message, never
// double-appends a partial tail.
function applyReplay(
  store: Store,
  clientId: string,
  messageId: string,
  events: ChatEvent[],
): void {
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (draft) => {
      const conv = draft.get(clientId);
      if (conv) {
        replayFrames(conv, messageId, events);
      }
    }),
  );
}

// Mint a bare AI row (with its turnId) directly in the ACTIVE conversation. The
// last-resort target when a resumed turn has neither an existing AI row nor a
// human row to pair (a live text turn switched away from before anything
// persisted — messages_v2 returns it empty). The reconnect target IS the active
// conversation, so its frames belong here. Guarded by the caller on there being
// an active conversation, so the #191 buffer path (turn for a not-yet-hydrated
// OTHER view, no active slot) is untouched. Returns the new row's location, or
// undefined when there is no active conversation to mint into.
function createAiRowInActiveConversation(
  store: Store,
  turnId: number,
): { clientId: string; messageId: string } | undefined {
  const activeId = store.get(activeConversationIdAtom);
  if (activeId === null) {
    return undefined;
  }
  const conversations = store.get(conversationsAtom);
  if (!conversations.has(activeId)) {
    return undefined;
  }
  const messageId = makeId();
  store.set(
    conversationsAtom,
    produce(conversations, (draft) => {
      draft.get(activeId)?.history.push({
        id: messageId,
        author: "ai",
        turnId,
        content: [],
        streamingState: "streaming",
      });
    }),
  );
  return { clientId: activeId, messageId };
}

// Resolve the AI target for a turn (existing row, else mint one paired to the
// human row, else — for a persisted-nothing live turn — mint one in the active
// conversation) and write the from-head run into it. Returns false when no row
// carries the turn AND there is no active conversation to mint into (the #191
// race) so the caller keeps buffering.
function applyToTurn(store: Store, turnId: number, run: ChatEvent[]): boolean {
  const target =
    findMessageByTurnId(store, turnId) ??
    createAiRowForTurn(store, turnId) ??
    createAiRowInActiveConversation(store, turnId);
  if (target === undefined) {
    return false;
  }
  applyReplay(store, target.clientId, target.messageId, run);
  return true;
}

// A placeholder location: the AI row `onOpen` minted, awaiting its first frame.
type Placeholder = { clientId: string; messageId: string };

// Mint the Thinking… AI placeholder in the active conversation, returning its
// location so the caller can later claim or drop it. Seeded `streaming`, NOT
// `pending`: reconnect resumes a stream that ALREADY opened before the switch, so
// its turn was showing "Thinking…" (the `streaming`, no-part state) — seeding
// `pending` would flash a spinner and regress the turn to a pre-open state it had
// already left. This also matches `createAiRowForTurn`, the other reconnect mint
// path. The B gate: skip when NO active conversation, or when the conversation
// already has ANY AI row (a live tail, or a settled reply from history — a
// completed-turn revisit must not flash a placeholder). A never-yet-answered turn
// (empty tail human row, or an empty conversation racing history) is the case we
// DO want to cover.
function mintThinkingPlaceholder(store: Store): Placeholder | undefined {
  const activeId = store.get(activeConversationIdAtom);
  if (activeId === null) {
    return undefined;
  }
  const conv = store.get(conversationsAtom).get(activeId);
  if (conv === undefined || conv.history.some((m) => m.author === "ai")) {
    return undefined;
  }
  const messageId = makeId();
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (draft) => {
      draft.get(activeId)?.history.push({
        id: messageId,
        author: "ai",
        content: [],
        streamingState: "streaming",
      });
    }),
  );
  return { clientId: activeId, messageId };
}

// Claim the `onOpen` placeholder for `turnId`: stamp the turnId, then write the
// from-head run into it (replayFrames flips it to `streaming`) — the reconnect
// mirror of the live send's `pending → streaming` transition. Returns true when
// the claim applied (the placeholder row still exists), so the caller skips the
// find/mint path and clears its tracked placeholder.
function claimPlaceholder(
  store: Store,
  placeholder: Placeholder,
  turnId: number,
  run: ChatEvent[],
): boolean {
  const conv = store.get(conversationsAtom).get(placeholder.clientId);
  if (conv?.history.find((m) => m.id === placeholder.messageId) === undefined) {
    return false;
  }
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (draft) => {
      const target = draft
        .get(placeholder.clientId)
        ?.history.find((m) => m.id === placeholder.messageId);
      if (target) {
        target.turnId = turnId;
      }
    }),
  );
  applyReplay(store, placeholder.clientId, placeholder.messageId, run);
  return true;
}

// Drop a never-claimed placeholder (the stream ended before any frame). Matches
// only an UNCLAIMED row (no turnId) — a claimed row carries a turnId and is left
// standing. A no-op once the row is gone.
function removePlaceholder(store: Store, placeholder: Placeholder): void {
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (draft) => {
      const conv = draft.get(placeholder.clientId);
      if (!conv) {
        return;
      }
      const i = conv.history.findIndex(
        (m) => m.id === placeholder.messageId && m.turnId === undefined,
      );
      if (i !== -1) {
        conv.history.splice(i, 1);
      }
    }),
  );
}

// Reconnect replay handler. Each call carries the whole from-head run
// (last-write-wins); rAF coalesces rapid calls into one store write per frame.
//
// Hydration race: reconnect probes in parallel with history, so a resumed turn's
// frames can arrive BEFORE history hydrates that turn. When the target isn't
// found yet the run is buffered and a one-shot conversationsAtom subscription
// retries it on the next store change, then unsubscribes — otherwise a reconnect
// that wins the race would silently drop the resumed turn (issue #191).
//
// A class (not a closure) keeps each concern a small method — sidestepping
// max-lines-per-function on the factory and the no-param-reassign that threading
// a mutable state bag through module helpers would trip (mirrors
// ReconnectController in use-reconnect).
class ReplayCoalescer {
  private latest: ChatEvent[] | null = null;
  private rafId: number | null = null;
  private unsubscribe: (() => void) | null = null;
  // The `onOpen` placeholder awaiting its first frame. Set on open, cleared once
  // claimed by a frame or dropped on stream end.
  private placeholder: Placeholder | null = null;
  // Re-entrancy guard: minting the AI row (and the apply) call `store.set`, which
  // synchronously notifies the `conversationsAtom` subscription that drives
  // `attempt`. Without this flag that nested call would re-enter mid-write —
  // jotai forbids a `set` during its own notification flush (it throws), and a
  // second mint would duplicate the row. The re-entrant tick bails here and the
  // outer call finishes the work.
  private applying = false;

  constructor(private readonly store: Store) {}

  // Single apply funnel for both the rAF tick and the hydration subscription.
  // Clears `latest` BEFORE writing so a re-entrant notification can't double-apply.
  private attempt = (): void => {
    if (this.latest === null || this.applying) {
      return;
    }
    const turnId = extractTurnId(this.latest);
    if (turnId === undefined) {
      this.latest = null; // keepalive-only run, nothing to apply
      return;
    }
    const run = this.latest;
    this.applying = true;
    try {
      // First frame after open: claim the placeholder in place (mirror of the
      // live send's pending→streaming). Falls through to find/mint only if the
      // placeholder is gone (view reset) — the row then carries a turnId and the
      // usual dedup applies.
      if (
        this.placeholder !== null &&
        claimPlaceholder(this.store, this.placeholder, turnId, run)
      ) {
        this.placeholder = null;
      } else if (!applyToTurn(this.store, turnId, run)) {
        // Turn not hydrated yet — keep buffered, retry on the next atom change.
        this.unsubscribe ??= this.store.sub(conversationsAtom, this.attempt);
        return;
      }
      this.latest = null;
      this.unsubscribe?.();
      this.unsubscribe = null;
    } finally {
      this.applying = false;
    }
  };

  onReplay = (events: ChatEvent[]): void => {
    this.latest = events;
    if (this.rafId !== null) {
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.attempt();
    });
  };

  onOpen = (): void => {
    // At most one placeholder per open episode; a re-open before a claim keeps
    // the existing one rather than stacking a second.
    if (this.placeholder !== null) {
      return;
    }
    this.placeholder = mintThinkingPlaceholder(this.store) ?? null;
  };

  onStreamEnd = (): void => {
    if (this.placeholder === null) {
      return;
    }
    removePlaceholder(this.store, this.placeholder);
    this.placeholder = null;
  };

  dispose = (): void => {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.latest = null;
    this.placeholder = null;
  };
}

export function createOnReplay(store: Store): OnReplay {
  const c = new ReplayCoalescer(store);
  return {
    onReplay: c.onReplay,
    onOpen: c.onOpen,
    onStreamEnd: c.onStreamEnd,
    dispose: c.dispose,
  };
}
