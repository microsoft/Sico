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

import { ChatStreamHttpError, type OpenChatStreamOptions } from "./chat-stream";
import { reduceFrame } from "./frame-reducer";
import { logoutAtom } from "../../../atoms/auth-atom";
import { assertNever } from "../../../utils/assert-never";
import { makeId } from "../../../utils/id";
import { logger } from "../../../utils/logger";
import {
  activeConversationIdAtom,
  type Conversation,
  conversationsAtom,
  lastActivityAtom,
  type Message,
  type StreamingState,
} from "../atoms/chat-atom";
import { HANDOFF_ABORT_REASON, SEND_FAILED_COPY } from "../constants";
import { type ChatEvent, MARKDOWN_CONTENT_TYPE } from "../schemas/chat-event";
import {
  type ChatAttachmentRef,
  type ChatRequest,
} from "../schemas/chat-request";

type Store = ReturnType<typeof createStore>;

const HTTP_UNAUTHORIZED = 401;

// Injected transport — the real `openChatStream` with its `url` already bound
// by the hook, or a fake in tests. The orchestrator supplies only the per-turn
// options (onOpen/onEvent/signal); the URL is not its concern.
type OpenChatStream = (
  payload: ChatRequest,
  options: Omit<OpenChatStreamOptions, "url">,
) => Promise<void>;

export type SendMessageContext = {
  agentInstanceId: number;
  // Target conversation (dwp multi-conversation). Passed EXPLICITLY (not read
  // back from the store) so a send is correct even when the conversation slot
  // hasn't been hydrated yet — the create-first hand-off parks this id and the
  // consumer forwards it here, racing ahead of `useHistory`'s slot creation.
  // Omitted for sico (v1), where the backend derives the single conversation.
  conversationId?: number;
  openChatStream: OpenChatStream;
  toastError: (message: string) => void;
  // Fired once when the turn reaches a terminal state THIS orchestrator owns
  // after the stream opened — a `done`/`error` frame, or a user Stop-abort of a
  // streamed reply. By then the turn is (partially) persisted server-side. The
  // caller uses it to invalidate the history query cache for this conversation,
  // so a later remount refetches the real turn instead of a stale empty seed
  // (create-first leaves the history cache seeded empty; nothing else writes sent
  // messages back into it). NOT fired when: the stream never opened (pre-open
  // failure/abort/401 — nothing persisted, placeholder dropped); OR a recoverable
  // drop (truncation / mid-stream transport failure / reconnect hand-off) leaves
  // the turn `streaming` for the recovery loop, which owns the terminal state and
  // its own history invalidation (use-reconnect `onSettle`).
  onSettle?: () => void;
};

// Immer-produce a single conversation in the Map by client id.
function updateConversation(
  store: Store,
  clientId: string,
  recipe: (draft: Conversation) => void,
): void {
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (map) => {
      const conv = map.get(clientId);
      if (conv) {
        recipe(conv);
      }
    }),
  );
}

// Orchestrates one chat turn over (ChatEvents × store) — no React, no network;
// `openChatStream` and the store handle are injected (testable in isolation).
// eslint-disable-next-line max-lines-per-function -- single-turn orchestrator whose 6 inner closures share per-turn mutable state (aiMessageId/buffer/rafId/sawTerminal/controller); extracting them would thread a mutable context through module helpers and restructure the streaming logic
export async function sendMessage(
  store: Store,
  text: string,
  attachments: ChatAttachmentRef[],
  ctx: SendMessageContext,
): Promise<void> {
  const controller = new AbortController();

  // 1. Append the human message synchronously on click + open the slot.
  const humanMessage: Message = {
    id: makeId(),
    author: "human",
    content: text ? [{ partId: makeId(), type: "text", text }] : [],
    // The send carries no server time, so stamp a client one — else the
    // just-sent bubble renders with no timestamp until a history reload brings
    // the server `createdAt`. Legacy did the same (`Date.now()` on the user
    // section). Display-only; never sent back or used for identity/ordering.
    createdAt: Date.now(),
  };
  // Render sent attachments immediately on the optimistic message
  // (`ChatAttachmentRef` is structurally a `MessageAttachment`). Omit on a
  // plain turn (absent, not []).
  if (attachments.length > 0) {
    humanMessage.attachments = attachments;
  }

  // Resolve the conversation slot this turn writes into. A known server
  // `conversationId` (dwp) keys the slot by `String(conversationId)` — the SAME
  // key `ensureConversationForServerId` (use-history) uses, so send + history
  // hydrate into ONE slot even when they race. Else (sico v1) reuse the active
  // slot or mint a UUID. Every closure below keys off this `clientId`.
  const activeId = store.get(activeConversationIdAtom);
  const activeConv =
    activeId === null ? undefined : store.get(conversationsAtom).get(activeId);
  const clientId =
    ctx.conversationId !== undefined
      ? String(ctx.conversationId)
      : (activeConv?.clientId ?? makeId());
  // Per-turn streaming state (closure-local). `aiMessageId` minted now so the
  // placeholder can be created on click.
  const aiMessageId = makeId();
  let buffer = "";
  let rafId: number | null = null;
  // Did the stream open (`onopen`)? Distinguishes the ↻ window (placeholder,
  // no frames) from an open stream — a pre-open failure/abort removes the
  // never-streamed placeholder rather than leaving an empty bubble.
  let sawOpen = false;
  // Did a real terminal frame (`done`/`error`) arrive? Distinguishes a normal
  // close from a truncation when `openChatStream` resolves.
  let sawTerminal = false;

  // Append the human message AND the AI placeholder synchronously on click. The
  // placeholder seeds `pending` (the ↻ window) so thinking renders before the
  // round-trip; `onopen` later flips it to `streaming`.
  const aiPlaceholder: Message = {
    id: aiMessageId,
    author: "ai",
    content: [],
    streamingState: "pending",
  };
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (map) => {
      const conv = map.get(clientId);
      if (conv) {
        conv.history.push(humanMessage, aiPlaceholder);
        conv.sendHandle = controller;
      } else {
        map.set(clientId, {
          clientId,
          // Stamp the server id (may be undefined for sico v1) so history
          // hydration — keyed by the same String(conversationId) — merges into
          // THIS slot and future sends carry the id.
          conversationId: ctx.conversationId,
          history: [humanMessage, aiPlaceholder],
          sendHandle: controller,
        });
      }
    }),
  );
  store.set(activeConversationIdAtom, clientId);

  const flush = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (buffer) {
      const chunk = buffer;
      buffer = "";
      const id = aiMessageId;
      updateConversation(store, clientId, (draft) => {
        // Coalesced chunk → shared reducer (one text Part per flush).
        reduceFrame(draft, id, {
          event: "message",
          data: { type: MARKDOWN_CONTENT_TYPE, content: chunk },
        });
      });
    }
  };

  const scheduleFlush = (): void => {
    if (rafId !== null) {
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      flush();
    });
  };

  const setStreamingState = (state: StreamingState): void => {
    updateConversation(store, clientId, (draft) => {
      const ai = draft.history.find((m) => m.id === aiMessageId);
      if (ai) {
        ai.streamingState = state;
      }
    });
  };

  // Drop the never-streamed placeholder (pre-open failure/abort), leaving the
  // human message standing.
  const removePlaceholder = (): void => {
    updateConversation(store, clientId, (draft) => {
      const i = draft.history.findIndex((m) => m.id === aiMessageId);
      if (i !== -1) {
        draft.history.splice(i, 1);
      }
    });
  };

  const clearHandle = (): void => {
    updateConversation(store, clientId, (draft) => {
      draft.sendHandle = undefined;
    });
  };

  const handleOpen = (): void => {
    // `onopen` flips the click-time placeholder `pending → streaming` (↻→■);
    // a transition, not an append.
    sawOpen = true;
    setStreamingState("streaming");
    // Stamp liveness at open too: the first send of a session leaves
    // `lastActivityAtom` at 0, so without this the whole slow-first-token window
    // would read as stale and the recovery watchdog would abort a healthy stream.
    store.set(lastActivityAtom, Date.now());
  };

  // Pure liveness for the recovery staleness watchdog — fired on EVERY frame
  // (keepalive included) by the transport, BEFORE keepalives are filtered out of
  // `onEvent`. A quiet-but-alive stream (only keepalives) must keep this clock
  // fresh so `maybeResume` doesn't misjudge it dead and reconnect (double-delivery).
  const handleLive = (): void => {
    store.set(lastActivityAtom, Date.now());
  };

  // Capture server metadata a message frame may carry onto the conversation
  // (conversationId) and the AI message (createdAt, turnId). First frame to
  // carry each field wins (write-once `??=`). Guards are `!== undefined`, not
  // truthy: these are int64 wire ids where `0` is a valid value the backend may
  // send (msg.proto omits no field), so a truthy check would wrongly skip it.
  const captureMeta = (data: {
    conversationId?: number;
    timestamp?: number;
    turnId?: number;
  }): void => {
    const { conversationId, timestamp, turnId } = data;
    if (
      conversationId === undefined &&
      timestamp === undefined &&
      turnId === undefined
    ) {
      return;
    }
    updateConversation(store, clientId, (draft) => {
      if (conversationId !== undefined) {
        draft.conversationId ??= conversationId;
      }
      const aiIndex = draft.history.findIndex((m) => m.id === aiMessageId);
      const ai = aiIndex === -1 ? undefined : draft.history[aiIndex];
      if (ai) {
        if (timestamp !== undefined) {
          ai.createdAt ??= timestamp;
        }
        if (turnId !== undefined) {
          ai.turnId ??= turnId;
        }
      }
      // Stamp the turnId onto THIS turn's human row too (the row pushed directly
      // before the AI placeholder — see the send path). Without it the just-sent
      // human message stays turnId-less, so a reconnect + history reload can't
      // dedup it by turnId in `mergeHistory` and it lands at the tail, out of
      // order. Write-once (`??=`), same first-frame-wins rule as the AI row.
      if (turnId !== undefined && aiIndex > 0) {
        const human = draft.history[aiIndex - 1];
        if (human?.author === "human") {
          human.turnId ??= turnId;
        }
      }
    });
  };

  const handleEvent = (event: ChatEvent): void => {
    switch (event.event) {
      case "message": {
        captureMeta(event.data);
        // Text coalesces through the buffer. Any other frame: flush pending
        // text FIRST so order is preserved (a plan Part never jumps ahead of
        // buffered text), then let the reducer turn it into a Part or skip-log.
        if (event.data.type === MARKDOWN_CONTENT_TYPE) {
          buffer += event.data.content;
          scheduleFlush();
          break;
        }
        flush();
        updateConversation(store, clientId, (draft) => {
          reduceFrame(draft, aiMessageId, event);
        });
        break;
      }
      case "done": {
        sawTerminal = true;
        flush();
        setStreamingState("done");
        ctx.onSettle?.();
        break;
      }
      case "error": {
        sawTerminal = true;
        flush();
        setStreamingState("error");
        ctx.toastError(SEND_FAILED_COPY);
        ctx.onSettle?.();
        break;
      }
      default:
        // Exhaustive union (message/done/error): assertNever turns a future
        // unhandled variant into a compile error, not a dropped frame.
        assertNever(event);
    }
  };

  try {
    await ctx.openChatStream(
      {
        agentInstanceId: ctx.agentInstanceId,
        message: text,
        attachments,
        // Target the conversation explicitly (dwp). From ctx (the create-first
        // hand-off), NOT the store, so it's present even before the slot
        // hydrates. Omitted for sico (v1) — backend derives the single one.
        ...(ctx.conversationId !== undefined && {
          conversationId: ctx.conversationId,
        }),
      },
      {
        onOpen: handleOpen,
        onEvent: handleEvent,
        onLive: handleLive,
        signal: controller.signal,
      },
    );
    flush();
    if (controller.signal.aborted) {
      // (a) Abort while open. Two kinds, told apart by the abort `reason`:
      //   - Reconnect hand-off: recovery aborted this (zombie) live stream to
      //     resume the turn over the reconnect transport. Leave the AI message
      //     `streaming` and settle NOTHING — the reconnect loop owns the turn's
      //     terminal state now. (Marking it `done` here would let replayFrames
      //     refuse to revert it, freezing the turn at its partial content.)
      //   - User Stop / ↻-cancel: mark the partial reply `done` and settle so a
      //     revisit refetches the persisted partial.
      // The transport RESOLVES on abort (never throws AbortError). Silent, no toast.
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- closure-escape limitation: `sawOpen` is mutated in the injected onOpen closure during the await; tsgo + typescript-eslint accept the guard
      if (sawOpen) {
        if (controller.signal.reason !== HANDOFF_ABORT_REASON) {
          setStreamingState("done");
          ctx.onSettle?.();
        }
      } else {
        // Abort during the ↻ window: placeholder never streamed → drop it.
        removePlaceholder();
      }
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- closure-escape limitation: `sawOpen` is mutated in the injected onOpen closure during the await; tsgo + typescript-eslint accept the guard
    } else if (!sawOpen) {
      // Resolved without ever opening (no frames, no abort): drop the
      // never-streamed placeholder.
      removePlaceholder();
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- closure-escape limitation: `sawTerminal` is mutated in the injected onEvent closure during the await; tsgo + typescript-eslint accept the guard
    } else if (!sawTerminal) {
      // (b) Truncation: opened, then resolved with no `done`/`error` and the tail
      // still `streaming`. This is a recoverable transport drop (e.g. screen
      // sleep), NOT a failed turn — leave it `streaming` and hand it to the
      // recovery loop, which reconnects and replays the turn from head. No error
      // toast (nothing for the user to act on) and no settle (recovery owns the
      // terminal state). Legacy did the same via its TypeError→retry branch.
      //
      // Cross-module contract (deliberate, not a gap): the terminal state of a
      // dropped-open turn is owned by the co-mounted reconnect loop
      // (collaboration.tsx always mounts `useReconnect` alongside a send). A
      // self-settle here would double-settle against that loop and, once marked
      // `done`, `replayFrames` would refuse to revert it — freezing the partial.
      // So a caller of `sendMessage` WITHOUT a reconnect loop must own recovery
      // itself; there is intentionally no in-module error fallback.
    }
    // (c) Normal close: a `done`/`error` frame already ran → no-op.
  } catch (err) {
    if (
      err instanceof ChatStreamHttpError &&
      err.status === HTTP_UNAUTHORIZED
    ) {
      // Stream 401 at onopen → reuse the auth-expiry flow: logoutAtom nulls
      // userAtom, <AuthGate> redirects to /login. No toast (re-auth, not an
      // error). The 401 throws BEFORE onOpen → drop the placeholder.
      removePlaceholder();
      store.set(logoutAtom);
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- closure-escape limitation: `sawOpen` is mutated in the injected onOpen closure across the await; tsgo + typescript-eslint accept it
    } else if (!sawOpen) {
      // Failure before onopen (non-401): drop the placeholder, idle, toast.
      logger.error("chat: send failed before open", { err });
      removePlaceholder();
      ctx.toastError(SEND_FAILED_COPY);
    } else {
      // Mid-stream transport failure AFTER open: a recoverable drop (legacy's
      // TypeError branch), not a settled error. Leave the tail `streaming` and
      // hand it to the recovery loop — no error toast, no settle (recovery owns
      // the terminal state). `warn` not `error`: this is an expected, recovered
      // condition, not a fault. (A real server failure arrives as an `error`
      // FRAME, handled in handleEvent — that path still toasts + settles.)
      logger.warn("chat: stream dropped mid-turn, handing to recovery", {
        err,
      });
      flush();
    }
  } finally {
    clearHandle();
  }
}

// Stop is a separate concern (transport teardown, not per-turn streaming state),
// so it lives in `stop-turn.ts`. Re-exported here to preserve the public entry —
// `use-chat` and tests import `stopTurn` / `StopTurnContext` from this module.
export { stopTurn, type StopTurnContext } from "./stop-turn";
