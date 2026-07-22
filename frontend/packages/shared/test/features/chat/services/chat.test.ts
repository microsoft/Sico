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

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loginAtom, userAtom } from "@/atoms/auth-atom";
import {
  activeConversationAtom,
  activeConversationIdAtom,
  type Conversation,
  conversationsAtom,
  lastActivityAtom,
  type Message,
} from "@/features/chat/atoms/chat-atom";
import { HANDOFF_ABORT_REASON } from "@/features/chat/constants";
import { type ChatEvent } from "@/features/chat/schemas/chat-event";
import { type ChatAttachmentRef } from "@/features/chat/schemas/chat-request";
import {
  sendMessage,
  type SendMessageContext,
  stopTurn,
  type StopTurnContext,
} from "@/features/chat/services/chat";
import { ChatStreamHttpError } from "@/features/chat/services/chat-stream";
import { logger } from "@/utils/logger";

type StreamScript = (api: {
  onOpen: () => void;
  onEvent: (e: ChatEvent) => void;
  onLive: () => void;
}) => void | Promise<void>;

// A fake transport: scripts ChatEvents, calls onOpen, resolves. Replaces the
// real fetch/SSE entirely — the plain-fn payoff. NOTE: the real transport
// RESOLVES on caller-abort (never throws AbortError — see chat-stream.test.ts),
// so the abort tests below abort the in-flight handle and then resolve.
function fakeStream(
  script: StreamScript,
): SendMessageContext["openChatStream"] {
  return async (_payload, opts) => {
    await script({
      onOpen: () => opts.onOpen?.(),
      onEvent: opts.onEvent,
      onLive: () => opts.onLive?.(),
    });
  };
}

const toast = { error: vi.fn() };
const ctx = (
  openChatStream: SendMessageContext["openChatStream"],
  overrides?: Partial<SendMessageContext>,
): SendMessageContext => ({
  agentInstanceId: 1,
  openChatStream,
  toastError: toast.error,
  ...overrides,
});

describe("sendMessage", () => {
  it("creates the AI placeholder synchronously on click (pending) before the stream opens", async () => {
    const store = createStore();
    // A stream that never opens and never emits: capture the store state during
    // the in-flight window. The placeholder must already exist, in `pending`.
    let pendingTail: Message | undefined;
    const stream = fakeStream(() => {
      pendingTail = store.get(activeConversationAtom)?.history.at(-1);
      // resolve without onOpen → truncation-before-open path
    });
    await sendMessage(store, "hello", [], ctx(stream));
    expect(pendingTail).toMatchObject({
      author: "ai",
      streamingState: "pending",
    });
  });

  it("appends a human message synchronously and an AI message on open", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "hi" } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "hello", [], ctx(stream));
    const conv = store.get(activeConversationAtom);
    expect(conv?.history[0]).toMatchObject({ author: "human" });
    expect(conv?.history[1]).toMatchObject({
      author: "ai",
      streamingState: "done",
    });
  });

  it("calls onSettle when the turn completes (done) so history can be refreshed", async () => {
    const store = createStore();
    const onSettle = vi.fn();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "hi" } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "hello", [], ctx(stream, { onSettle }));
    // The turn is now persisted server-side; the caller invalidates the history
    // cache so a later remount refetches the real turn (not the stale empty seed).
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("calls onSettle when the turn errors so history can still be refreshed", async () => {
    const store = createStore();
    const onSettle = vi.fn();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "error", data: "boom" });
    });
    await sendMessage(store, "hello", [], ctx(stream, { onSettle }));
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("calls onSettle on Stop mid-stream (the streamed partial is persisted)", async () => {
    const store = createStore();
    const onSettle = vi.fn();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "half" } });
      // Stop → abort the in-flight handle; the transport resolves on abort.
      store.get(activeConversationAtom)?.sendHandle?.abort();
    });
    await sendMessage(store, "x", [], ctx(stream, { onSettle }));
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("hands an open truncated turn to recovery: stays streaming, no settle", async () => {
    const store = createStore();
    const onSettle = vi.fn();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "partial" } });
      // no done/error frame — stream just resolves while still streaming
    });
    await sendMessage(store, "x", [], ctx(stream, { onSettle }));
    const ai = store.get(activeConversationAtom)?.history[1];
    // A screen-sleep drop truncates the live stream, but the turn is NOT dead —
    // reconnect resumes it. Leave it streaming and DON'T settle here; the
    // recovery path owns the terminal state (it settles on the real done/error).
    expect(ai?.streamingState).toBe("streaming");
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("hands an open mid-stream transport failure to recovery: stays streaming, no settle", async () => {
    const store = createStore();
    const onSettle = vi.fn();
    // The hand-off logs a diagnostic warn; silence it so the run stays pristine.
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const stream = fakeStream(({ onOpen }) => {
      onOpen();
      throw new Error("network dropped mid-stream");
    });
    await sendMessage(store, "x", [], ctx(stream, { onSettle }));
    const ai = store.get(activeConversationAtom)?.history[1];
    // Same as truncation: a transport-level reject after open is a recoverable
    // drop (legacy's TypeError branch), not a settled turn. Hand it off.
    expect(ai?.streamingState).toBe("streaming");
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("stamps lastActivity on each streamed frame (feeds the recovery staleness watchdog)", async () => {
    const store = createStore();
    const before = Date.now();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "hi" } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    // A live stream keeps this clock fresh; recovery reads it to tell a healthy
    // stream (fresh) from a dead one (stale) and skip a needless reconnect.
    expect(store.get(lastActivityAtom)).toBeGreaterThanOrEqual(before);
  });

  it("stamps lastActivity on open, before any content frame (covers the slow-first-token window)", async () => {
    // The first send of a session leaves lastActivityAtom at its initial 0. If
    // `onopen` didn't stamp, the whole thinking window before the first token
    // would read as astronomically stale and a wake trigger would abort the
    // healthy stream (the C1 false-positive). Stamping on open closes that gap.
    const store = createStore();
    store.set(lastActivityAtom, 0);
    const before = Date.now();
    let stampedAtOpen = 0;
    const stream = fakeStream(({ onOpen }) => {
      onOpen();
      // Capture the clock right after open, with NO content frame yet.
      stampedAtOpen = store.get(lastActivityAtom);
    });
    await sendMessage(store, "x", [], ctx(stream));
    expect(stampedAtOpen).toBeGreaterThanOrEqual(before);
  });

  it("stamps lastActivity on a keepalive (onLive), so a quiet-but-alive stream never looks stale", async () => {
    // Keepalives never reach onEvent (filtered in the transport), so without
    // onLive stamping a turn emitting only keepalives for >15s would be judged
    // dead and reconnected — the C1 false-positive. onLive keeps the clock fresh.
    const store = createStore();
    let stampedAtKeepalive = 0;
    const before = Date.now();
    const stream = fakeStream(({ onOpen, onLive }) => {
      onOpen();
      store.set(lastActivityAtom, 0); // reset the open-stamp to isolate onLive
      onLive(); // a keepalive: liveness only, no content frame
      stampedAtKeepalive = store.get(lastActivityAtom);
    });
    await sendMessage(store, "x", [], ctx(stream));
    expect(stampedAtKeepalive).toBeGreaterThanOrEqual(before);
  });

  it("on a reconnect-handoff abort: leaves the turn streaming and does NOT settle (unlike user Stop → done)", async () => {
    const store = createStore();
    const onSettle = vi.fn();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "half" } });
      // Recovery aborts the (zombie) live stream to resume it over the reconnect
      // transport — tagged with the handoff reason so this is NOT read as a Stop.
      store
        .get(activeConversationAtom)
        ?.sendHandle?.abort(HANDOFF_ABORT_REASON);
    });
    await sendMessage(store, "x", [], ctx(stream, { onSettle }));
    const ai = store.get(activeConversationAtom)?.history[1];
    // Handed off, not stopped: the turn stays live for the reconnect stream, and
    // the live-send path settles nothing (reconnect owns the terminal state).
    expect(ai?.streamingState).toBe("streaming");
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("does NOT call onSettle when the stream never opens (nothing persisted)", async () => {
    const store = createStore();
    const onSettle = vi.fn();
    const stream = fakeStream(async () => {
      throw new Error("network down");
    });
    await sendMessage(store, "x", [], ctx(stream, { onSettle }));
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("stamps the optimistic human message with a client createdAt (shows time before any reload)", async () => {
    // The send path mints no server timestamp, so without a client one the user's
    // own message renders with no time until history reloads. Mirror legacy: stamp
    // Date.now() at send so the just-sent bubble shows a time immediately. A later
    // reload replaces it with the server value (mergeHistory keeps the row by id).
    const store = createStore();
    const before = Date.now();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "hello", [], ctx(stream));
    const human = store.get(activeConversationAtom)?.history[0];
    expect(typeof human?.createdAt).toBe("number");
    expect(human?.createdAt).toBeGreaterThanOrEqual(before);
  });

  it("attaches the sent attachments to the optimistic human message", async () => {
    const store = createStore();
    const attachment: ChatAttachmentRef = {
      name: "espresso.html",
      size: 1024,
      type: "text/html",
      uri: "asset://espresso.html",
      sasUrl: "https://blob.test/espresso.html?sig=abc",
    };
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "see attached", [attachment], ctx(stream));
    const human = store.get(activeConversationAtom)?.history[0];
    expect(human?.attachments).toEqual([attachment]);
  });

  it("omits attachments on a human message sent without any", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "no files", [], ctx(stream));
    const human = store.get(activeConversationAtom)?.history[0];
    expect(human?.attachments).toBeUndefined();
  });

  it("appends into the existing active conversation, preserving loaded history", async () => {
    const store = createStore();
    // Seed a history-loaded active conversation (as useHistory hydrates it).
    const past: Message[] = [
      { id: "h1", author: "human", content: [], turnId: 1 },
      { id: "a1", author: "ai", content: [], turnId: 1 },
    ];
    store.set(
      conversationsAtom,
      new Map([["loaded", { clientId: "loaded", history: past }]]),
    );
    store.set(activeConversationIdAtom, "loaded");

    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "reply" } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "next question", [], ctx(stream));

    // Same conversation stays active — history is NOT discarded for a fresh one.
    expect(store.get(activeConversationIdAtom)).toBe("loaded");
    const conv = store.get(activeConversationAtom);
    expect(conv?.history).toHaveLength(4); // 2 loaded + human + ai
    expect(conv?.history[0]).toMatchObject({ id: "h1" });
    expect(conv?.history[1]).toMatchObject({ id: "a1" });
    expect(conv?.history[2]).toMatchObject({ author: "human" });
    expect(conv?.history[3]).toMatchObject({
      author: "ai",
      streamingState: "done",
    });
  });

  it("mints a fresh active conversation when none exists yet", async () => {
    const store = createStore();
    expect(store.get(activeConversationIdAtom)).toBeNull();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "first", [], ctx(stream));
    expect(store.get(activeConversationIdAtom)).not.toBeNull();
    expect(store.get(activeConversationAtom)?.history).toHaveLength(2);
  });

  it("stamps the AI message createdAt from the streamed frame timestamp (shows time without a refresh)", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({
        event: "message",
        data: { type: 1, content: "hi", timestamp: 1718000000 },
      });
      onEvent({ event: "done", data: { timestamp: 1718000005 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    const ai = store.get(activeConversationAtom)?.history[1];
    // The server time rides the frame (legacy ConversationSectionAdapter:69);
    // capturing it lets the just-streamed turn show its timestamp immediately,
    // matching what a history refresh would render.
    expect(ai?.createdAt).toBe(1718000000);
  });

  it("appends streamed text into the AI message content", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "hel" } });
      onEvent({ event: "message", data: { type: 1, content: "lo" } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    const ai = store.get(activeConversationAtom)?.history[1];
    expect(
      ai?.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
    ).toBe("hello");
  });

  it("skips a non-markdown message type (logs, does not append)", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 5, content: "" } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    const ai = store.get(activeConversationAtom)?.history[1];
    expect(ai?.content).toHaveLength(0);
  });

  it("creates a plan part from a PLAN frame (type 9) carrying a turnId", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 9, content: "", turnId: 42 } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    const ai = store.get(activeConversationAtom)?.history[1];
    expect(ai?.content).toEqual([
      { partId: expect.any(String), type: "plan", planId: "42" },
    ]);
  });

  // The wire assigns the turn its id via a frame; the optimistic HUMAN row must
  // adopt it too (not just the AI row). Otherwise a just-sent human message stays
  // turnId-less, and on a reconnect + history reload `mergeHistory`'s turnId-dedup
  // can't recognise it as already-persisted — it gets appended to the tail, out
  // of order. First frame with a turnId wins (write-once), same as the AI row.
  it("stamps the human message with the turnId carried by a frame", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({
        event: "message",
        data: { type: 1, content: "hi", turnId: 61 },
      });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "再跑 90-95", [], ctx(stream));
    const human = store.get(activeConversationAtom)?.history[0];
    expect(human?.author).toBe("human");
    expect(human?.turnId).toBe(61);
  });

  it("does not overwrite a human turnId once set (first frame wins)", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({
        event: "message",
        data: { type: 1, content: "a", turnId: 61 },
      });
      // A later frame carrying a different turnId must NOT clobber the first.
      onEvent({
        event: "message",
        data: { type: 1, content: "b", turnId: 62 },
      });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    const human = store.get(activeConversationAtom)?.history[0];
    expect(human?.turnId).toBe(61);
  });

  it("keeps a plan part AFTER preceding text (flush-before-reduce preserves order)", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "before" } });
      onEvent({ event: "message", data: { type: 9, content: "", turnId: 7 } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    const ai = store.get(activeConversationAtom)?.history[1];
    // text Part first, plan Part second — never reordered
    expect(ai?.content).toEqual([
      { partId: expect.any(String), type: "text", text: "before" },
      { partId: expect.any(String), type: "plan", planId: "7" },
    ]);
  });

  it("maps an error frame to streamingState=error + toast", async () => {
    const store = createStore();
    toast.error.mockClear();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "error", data: "boom" });
    });
    await sendMessage(store, "x", [], ctx(stream));
    const ai = store.get(activeConversationAtom)?.history[1];
    expect(ai?.streamingState).toBe("error");
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("a truncated open turn keeps its partial content and raises NO error toast (handed to recovery)", async () => {
    const store = createStore();
    toast.error.mockClear();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "partial" } });
      // no done/error frame — stream just resolves while still streaming
    });
    await sendMessage(store, "x", [], ctx(stream));
    const ai = store.get(activeConversationAtom)?.history[1];
    // The rendered partial survives (reconnect replays from head over it), and
    // no "send failed" toast fires — a screen-sleep drop is recoverable, not an
    // error the user must see.
    expect(ai?.streamingState).toBe("streaming");
    expect(
      ai?.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
    ).toBe("partial");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does NOT re-toast on a normal done close (sawTerminal short-circuits)", async () => {
    const store = createStore();
    toast.error.mockClear();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "hi" } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    const ai = store.get(activeConversationAtom)?.history[1];
    expect(ai?.streamingState).toBe("done");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("on a 401 before onopen: logs out (no toast) so AuthGate redirects", async () => {
    const store = createStore();
    toast.error.mockClear();
    store.set(loginAtom, {
      tokenInfo: {
        accessToken: "tok",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
      user: { id: 1, email: "a@b.test", roles: [] },
    });
    const stream = fakeStream(async () => {
      throw new ChatStreamHttpError(401);
    });
    await sendMessage(store, "x", [], ctx(stream));
    expect(store.get(userAtom)).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("on Stop during streaming: silent done, no toast", async () => {
    const store = createStore();
    toast.error.mockClear();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 1, content: "half" } });
      // User clicks Stop → aborts the in-flight controller. The real transport
      // RESOLVES on abort (never throws AbortError), so model that: abort the
      // handle, then let the fake resolve.
      store.get(activeConversationAtom)?.sendHandle?.abort();
    });
    await sendMessage(store, "x", [], ctx(stream));
    const ai = store.get(activeConversationAtom)?.history[1];
    expect(ai?.streamingState).toBe("done");
    expect(
      ai?.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
    ).toBe("half");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("on abort during the ↻ window: keep human message, clear handle, no AI message, no toast", async () => {
    const store = createStore();
    toast.error.mockClear();
    const stream = fakeStream(() => {
      // never calls onOpen — abort before the stream opens
      store.get(activeConversationAtom)?.sendHandle?.abort();
    });
    await sendMessage(store, "x", [], ctx(stream));
    const conv = store.get(activeConversationAtom);
    expect(conv?.history).toHaveLength(1);
    expect(conv?.history[0]).toMatchObject({ author: "human" });
    expect(conv?.sendHandle).toBeUndefined();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("on failure before onopen: keep human message, clear handle, toast", async () => {
    const store = createStore();
    toast.error.mockClear();
    const stream = fakeStream(async () => {
      throw new Error("network down");
    });
    await sendMessage(store, "x", [], ctx(stream));
    const conv = store.get(activeConversationAtom);
    expect(conv?.history).toHaveLength(1);
    expect(conv?.sendHandle).toBeUndefined();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures the server conversationId once (first frame wins)", async () => {
    const store = createStore();
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({
        event: "message",
        data: { type: 1, content: "a", conversationId: 1 },
      });
      onEvent({
        event: "message",
        data: { type: 1, content: "b", conversationId: 2 },
      });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    expect(store.get(activeConversationAtom)?.conversationId).toBe(1);
  });

  it("logs a known non-markdown frame at debug, not warn", async () => {
    const store = createStore();
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 5, content: "" } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    expect(debug).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs an unknown (out-of-enum) frame type at warn", async () => {
    const store = createStore();
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const stream = fakeStream(({ onOpen, onEvent }) => {
      onOpen();
      onEvent({ event: "message", data: { type: 99, content: "???" } });
      onEvent({ event: "done", data: { timestamp: 1 } });
    });
    await sendMessage(store, "x", [], ctx(stream));
    expect(warn).toHaveBeenCalledOnce();
    expect(debug).not.toHaveBeenCalled();
  });
});

// Seed an active conversation directly (no live send): `stopTurn` reads the
// active conversation's streaming tail + `sendHandle` off the store.
function seedConversation(
  store: ReturnType<typeof createStore>,
  conv: Conversation,
): void {
  store.set(conversationsAtom, new Map([[conv.clientId, conv]]));
  store.set(activeConversationIdAtom, conv.clientId);
}

const stopCtx = (
  overrides: Partial<StopTurnContext> = {},
): StopTurnContext => ({
  cancelPlan: vi.fn().mockResolvedValue(undefined),
  reconnectStop: vi.fn(),
  toastError: vi.fn(),
  ...overrides,
});

describe("stopTurn", () => {
  it("plan path: cancels the plan FIRST, then stops reconnect, then aborts the chat handle", async () => {
    const store = createStore();
    const controller = new AbortController();
    const order: string[] = [];
    const abortSpy = vi
      .spyOn(controller, "abort")
      .mockImplementation(() => order.push("abort"));
    seedConversation(store, {
      clientId: "c1",
      history: [
        { id: "h", author: "human", content: [] },
        {
          id: "ai",
          author: "ai",
          streamingState: "streaming",
          content: [{ partId: "p", type: "plan", planId: "42" }],
        },
      ],
      sendHandle: controller,
    });
    const cancelPlan = vi.fn(async (turnId: number) => {
      order.push(`cancel:${turnId}`);
    });
    const reconnectStop = vi.fn(() => order.push("stop"));

    await stopTurn(store, stopCtx({ cancelPlan, reconnectStop }));

    // G4 / §6 Path B: cancel the backend plan before tearing down the streams,
    // and route the reconnect teardown through `stop()` (not a bare abort).
    expect(order).toEqual(["cancel:42", "stop", "abort"]);
    expect(abortSpy).toHaveBeenCalledOnce();
  });

  it("plan path: on cancel failure, toasts and leaves the turn running (no stop, no abort)", async () => {
    const store = createStore();
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    seedConversation(store, {
      clientId: "c1",
      history: [
        {
          id: "ai",
          author: "ai",
          streamingState: "streaming",
          content: [{ partId: "p", type: "plan", planId: "7" }],
        },
      ],
      sendHandle: controller,
    });
    const reconnectStop = vi.fn();
    const toastError = vi.fn();

    await stopTurn(
      store,
      stopCtx({
        cancelPlan: vi.fn().mockRejectedValue(new Error("server rejected")),
        reconnectStop,
        toastError,
      }),
    );

    // No silent return (design §6 Path B): surface a toast, and do NOT abort —
    // killing the chat stream while the backend plan still runs would orphan it.
    // The discarded cancel error is logged for diagnosis (not swallowed).
    expect(warn).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledOnce();
    expect(reconnectStop).not.toHaveBeenCalled();
    expect(abortSpy).not.toHaveBeenCalled();
  });

  it("text-only path: stops reconnect and aborts, never calls cancelPlan", async () => {
    const store = createStore();
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");
    seedConversation(store, {
      clientId: "c1",
      history: [
        {
          id: "ai",
          author: "ai",
          streamingState: "streaming",
          content: [{ partId: "p", type: "text", text: "partial" }],
        },
      ],
      sendHandle: controller,
    });
    const cancelPlan = vi.fn();
    const reconnectStop = vi.fn();

    await stopTurn(store, stopCtx({ cancelPlan, reconnectStop }));

    // C1 path: nothing to cancel, but Stop must STILL route through `stop()`
    // so a dropped-and-reconnecting turn doesn't silently resume.
    expect(cancelPlan).not.toHaveBeenCalled();
    expect(reconnectStop).toHaveBeenCalledOnce();
    expect(abortSpy).toHaveBeenCalledOnce();
  });
});
