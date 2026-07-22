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

import { produce } from "immer";
import { type createStore } from "jotai";

import { replayFrames } from "./frame-reducer";
import { makeId } from "../../../utils/id";
import {
  conversationsAtom,
  type Message,
  type TerminalStreamingState,
} from "../atoms/chat-atom";
import { type ChatEvent } from "../schemas/chat-event";

type Store = ReturnType<typeof createStore>;

export type OnReplay = {
  onReplay: (events: ChatEvent[]) => void;
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

// Resolve the AI target for a turn (existing row, else mint one paired to the
// human row) and write the from-head run into it. Returns false when no row
// carries the turn yet (the #191 race) so the caller keeps buffering.
function applyToTurn(store: Store, turnId: number, run: ChatEvent[]): boolean {
  const target =
    findMessageByTurnId(store, turnId) ?? createAiRowForTurn(store, turnId);
  if (target === undefined) {
    return false;
  }
  applyReplay(store, target.clientId, target.messageId, run);
  return true;
}

// Reconnect replay handler. Each call carries the whole from-head run
// (last-write-wins); rAF coalesces rapid calls into one store write per frame.
//
// Hydration race: reconnect probes in parallel with history, so a resumed turn's
// frames can arrive BEFORE history hydrates that turn. When the target isn't
// found yet the run is buffered and a one-shot conversationsAtom subscription
// retries it on the next store change, then unsubscribes — otherwise a reconnect
// that wins the race would silently drop the resumed turn (issue #191).
export function createOnReplay(store: Store): OnReplay {
  let latest: ChatEvent[] | null = null;
  let rafId: number | null = null;
  let unsubscribe: (() => void) | null = null;
  // Re-entrancy guard: minting the AI row (and the apply) call `store.set`, which
  // synchronously notifies the `conversationsAtom` subscription that drives
  // `attempt`. Without this flag that nested call would re-enter mid-write —
  // jotai forbids a `set` during its own notification flush (it throws), and a
  // second mint would duplicate the row. The re-entrant tick bails here and the
  // outer call finishes the work.
  let applying = false;

  // Single apply funnel for both the rAF tick and the hydration subscription.
  // Clears `latest` BEFORE writing so a re-entrant notification can't double-apply.
  const attempt = (): void => {
    if (latest === null || applying) {
      return;
    }
    const turnId = extractTurnId(latest);
    if (turnId === undefined) {
      latest = null; // keepalive-only run, nothing to apply
      return;
    }
    const run = latest;
    applying = true;
    try {
      if (!applyToTurn(store, turnId, run)) {
        // Turn not hydrated yet — keep buffered, retry on the next atom change.
        unsubscribe ??= store.sub(conversationsAtom, attempt);
        return;
      }
      latest = null;
      unsubscribe?.();
      unsubscribe = null;
    } finally {
      applying = false;
    }
  };

  const onReplay = (events: ChatEvent[]): void => {
    latest = events;
    if (rafId !== null) {
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      attempt();
    });
  };

  const dispose = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    unsubscribe?.();
    unsubscribe = null;
    latest = null;
  };

  return { onReplay, dispose };
}
