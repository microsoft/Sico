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
import { act, type PropsWithChildren, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logoutAtom, userAtom } from "@/atoms/auth-atom";
import {
  activeConversationIdAtom,
  type Conversation,
  conversationsAtom,
  lastActivityAtom,
} from "@/features/chat/atoms/chat-atom";
import { HANDOFF_ABORT_REASON } from "@/features/chat/constants";
import { useReconnect } from "@/features/chat/hooks/use-reconnect";
import { type ChatEvent } from "@/features/chat/schemas/chat-event";
import {
  ChatStreamHttpError,
  openReconnectStream,
  type OpenReconnectStreamOptions,
  type ReconnectStreamPayload,
} from "@/features/chat/services/reconnect-stream";

// Mock ONLY the transport — keep the real `ChatStreamHttpError` class so the
// hook's `instanceof` 401 branch matches against the genuine type (the same
// reason use-plan.test keeps the real `mergePlan`).
vi.mock("@/features/chat/services/reconnect-stream", async (importActual) => {
  const actual =
    await importActual<
      typeof import("@/features/chat/services/reconnect-stream")
    >();
  return { ...actual, openReconnectStream: vi.fn() };
});

// Stub the toast surface so the persistent-toast assertions are observable;
// everything else in `@sico/ui` stays real.
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return {
    ...actual,
    toast: { loading: vi.fn(), dismiss: vi.fn(), error: vi.fn() },
  };
});

function wrapper(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// One captured call to the mocked transport: its options (so the test can drive
// onOpen/onLive/onEvent) and a deferred to resolve (clean/abort close) or reject
// (401 / transport error) the stream on demand.
type StreamCall = {
  payload: ReconnectStreamPayload;
  options: OpenReconnectStreamOptions;
  deferred: Deferred<void>;
};

let streamCalls: StreamCall[] = [];

// Guarded accessor: `noUncheckedIndexedAccess` types `streamCalls[0]` as
// possibly-undefined, and the testing rule forbids `as`/`!` to silence it. Every
// test drives the single in-flight stream, so this throws a clear message if the
// expected call never happened rather than NPE-ing deep in an assertion.
function firstStream(): StreamCall {
  const call = streamCalls[0];
  if (!call) {
    throw new Error("expected an openReconnectStream call, but none was made");
  }
  return call;
}

function messageFrame(turnId: number, content: string): ChatEvent {
  return { event: "message", data: { type: 1, content, turnId } };
}

// Seed a live streaming turn into the store with an abortable send handle, so
// the wake tests can assert the staleness gate + live-send hand-off. Returns the
// AbortController so a test can spy on its `abort` reason. The AI row carries a
// `turnId` — the reconnect loop reconciles the resumed turn BY turnId, so only a
// turn that already has one is safe to hand off.
function seedStreamingTurn(
  store: ReturnType<typeof createStore>,
): AbortController {
  // A live streaming turn implies an authenticated session — the recovery gate
  // reads `isAuthenticatedAtom`, so seed a user or every wake would be skipped
  // as a dead session.
  store.set(userAtom, { id: 1, email: "a@b.test", roles: [] });
  const controller = new AbortController();
  const conv: Conversation = {
    clientId: "c1",
    history: [
      { id: "h", author: "human", content: [], turnId: 99 },
      {
        id: "ai",
        author: "ai",
        streamingState: "streaming",
        content: [],
        turnId: 99,
      },
    ],
    sendHandle: controller,
  };
  store.set(conversationsAtom, new Map([[conv.clientId, conv]]));
  store.set(activeConversationIdAtom, conv.clientId);
  return controller;
}

// Bring the mount-probe stream to a clean idle so a subsequent wake trigger is
// the one being measured. The probe opened stream #0; resolving it with no live
// turn observed settles the loop to idle after its backoff elapses — but simpler
// and deterministic: a `done`-free clean close then a long advance leaves the
// machine mid-backoff. Instead we drive a terminal `done` frame so the loop goes
// idle immediately (activeTurnId is undefined on the probe, so no settle churn).
async function idleAfterProbe(): Promise<void> {
  act(() => {
    firstStream().options.onEvent({ event: "done", data: { timestamp: 1 } });
  });
  await act(async () => {
    firstStream().deferred.resolve();
  });
  await flush();
}

// Let queued microtasks (the transport promise's `.then` continuation) run
// under fake timers, without advancing wall time.
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  streamCalls = [];
  vi.mocked(openReconnectStream).mockImplementation((payload, options) => {
    const d = deferred<void>();
    streamCalls.push({ payload, options, deferred: d });
    return d.promise;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useReconnect", () => {
  it("fires exactly one unconditional probe on mount", () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });

    expect(openReconnectStream).toHaveBeenCalledTimes(1);
    expect(openReconnectStream).toHaveBeenCalledWith(
      { agentInstanceId: 7, conversationId: 42 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("adds online + visibilitychange listeners on mount and removes them on unmount", () => {
    const addWin = vi.spyOn(window, "addEventListener");
    const addDoc = vi.spyOn(document, "addEventListener");
    const removeWin = vi.spyOn(window, "removeEventListener");
    const removeDoc = vi.spyOn(document, "removeEventListener");
    const store = createStore();

    const { unmount } = renderHook(() => useReconnect(7, 42), {
      wrapper: wrapper(store),
    });
    expect(addWin).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addDoc).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    unmount();
    expect(removeWin).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeDoc).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });

  it("on window focus with a STALE streaming turn, resumes: opens a reconnect stream", async () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();
    expect(openReconnectStream).toHaveBeenCalledTimes(1); // just the probe

    // A turn is live but its live-send stream went silent long ago (screen sleep).
    seedStreamingTurn(store);
    store.set(lastActivityAtom, Date.now() - 60000);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    // Wake detected staleness → hand-off → machine opens a fresh reconnect stream.
    expect(openReconnectStream).toHaveBeenCalledTimes(2);
  });

  it("on window pageshow with a STALE streaming turn, resumes (bfcache restore)", async () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();

    seedStreamingTurn(store);
    store.set(lastActivityAtom, Date.now() - 60000);

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(openReconnectStream).toHaveBeenCalledTimes(2);
  });

  it("on visibilitychange→visible with a STALE streaming turn, hands off the dead live-send stream", async () => {
    // Tab-switch-back is the common wake that fires `visibilitychange` but not
    // `focus`. It must bridge a DEAD live-send stream through the staleness gate
    // — aborting its handle with the hand-off reason and resuming — not just
    // poke the machine (which would open a reconnect stream WITHOUT tearing the
    // live-send down, risking double-delivery). (jsdom's visibilityState is
    // "visible", so the dispatched event passes the onVisible guard.)
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();

    const controller = seedStreamingTurn(store);
    const abortSpy = vi.spyOn(controller, "abort");
    store.set(lastActivityAtom, Date.now() - 60000);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(abortSpy).toHaveBeenCalledWith(HANDOFF_ABORT_REASON);
    expect(openReconnectStream).toHaveBeenCalledTimes(2);
  });

  it("on visibilitychange→visible with a FRESH streaming turn, does NOT reconnect (no double-delivery)", async () => {
    // The double-delivery guard must hold on the visibility path too: a healthy
    // live-send stream (fresh clock) must never be aborted or doubled just
    // because the tab regained visibility.
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();

    const controller = seedStreamingTurn(store);
    const abortSpy = vi.spyOn(controller, "abort");
    store.set(lastActivityAtom, Date.now());

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(abortSpy).not.toHaveBeenCalled();
    expect(openReconnectStream).toHaveBeenCalledTimes(1); // probe only
  });

  it("the staleness threshold sits at the keepalive contract (20s): just-under does NOT resume, just-over does", async () => {
    // The gate must not fire while a healthy stream could still be alive. The
    // backend keepalive cadence (the same contract the 20s stall watchdog relies
    // on) is the real bound: a turn quiet for less than that is presumed alive.
    // A tighter threshold would abort a healthy-but-quiet stream (plan step).
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();
    seedStreamingTurn(store);

    // 19s quiet — still inside the keepalive window ⇒ presumed alive, no resume.
    store.set(lastActivityAtom, Date.now() - 19000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(openReconnectStream).toHaveBeenCalledTimes(1); // probe only

    // 21s quiet — past the window ⇒ presumed dead, resume.
    store.set(lastActivityAtom, Date.now() - 21000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(openReconnectStream).toHaveBeenCalledTimes(2);
  });

  it("the staleness heartbeat resumes a silent streaming turn even when NO wake event fires", async () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();

    // A pure display-off drop: no focus, no visibility, no online — only the
    // periodic heartbeat can catch it. The turn is live but the clock is stale.
    seedStreamingTurn(store);
    store.set(lastActivityAtom, Date.now() - 60000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(openReconnectStream).toHaveBeenCalledTimes(2);
  });

  it("does NOT resume a FRESH streaming turn (double-delivery guard: the live stream is alive)", async () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();

    // The live-send stream is healthy — it stamped activity just now. A wake
    // trigger must NOT open a competing reconnect stream (would double-deliver).
    // (A genuinely healthy stream keeps stamping every frame, so it can never
    // look stale to the heartbeat; here the fresh stamp models that instant.)
    seedStreamingTurn(store);
    store.set(lastActivityAtom, Date.now());

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(openReconnectStream).toHaveBeenCalledTimes(1); // probe only
  });

  it("does NOT resume when no turn is streaming (nothing to recover)", async () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();

    // Idle chat (stale clock, but no streaming turn) — a wake trigger is a no-op.
    store.set(lastActivityAtom, Date.now() - 60000);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(openReconnectStream).toHaveBeenCalledTimes(1);
  });

  it("does NOT resume once the session is dead (no unauthenticated reconnect loop)", async () => {
    // After a 401→logout the streaming turn is left `streaming`, so without an
    // auth gate every wake (focus/pageshow/visibilitychange/heartbeat) would
    // re-POST an unauthenticated reconnect → 401 → repeat. The gate must stop
    // probing a dead session in-layer, not rely on the AuthGate unmount race.
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();

    seedStreamingTurn(store); // authenticates + seeds a stale-able streaming turn
    store.set(lastActivityAtom, Date.now() - 60000);
    store.set(logoutAtom); // session dies → userAtom null → isAuthenticated false

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    // No reconnect opened after logout — the probe from mount is the only call.
    expect(openReconnectStream).toHaveBeenCalledTimes(1);
  });

  it("does NOT resume a streaming turn that has no turnId yet (reconnect can't reconcile it)", async () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();

    // A turn that opened but hasn't captured a turnId yet (pre-first-frame).
    // Handing it off would let reconnect mint a SECOND ai row (it matches by
    // turnId) and orphan this one stuck `streaming` — the exact freeze this PR
    // fixes. So the gate must skip a turnId-less turn even when it looks stale.
    const controller = new AbortController();
    store.set(
      conversationsAtom,
      new Map([
        [
          "c1",
          {
            clientId: "c1",
            history: [
              { id: "h", author: "human", content: [] },
              {
                id: "ai",
                author: "ai",
                streamingState: "streaming",
                content: [],
              },
            ],
            sendHandle: controller,
          } satisfies Conversation,
        ],
      ]),
    );
    store.set(activeConversationIdAtom, "c1");
    store.set(lastActivityAtom, Date.now() - 60000);
    const abortSpy = vi.spyOn(controller, "abort");

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(openReconnectStream).toHaveBeenCalledTimes(1); // probe only
    expect(abortSpy).not.toHaveBeenCalled();
  });

  it("aborts the dead live-send stream with the hand-off reason before resuming", async () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    await idleAfterProbe();

    const controller = seedStreamingTurn(store);
    const abortSpy = vi.spyOn(controller, "abort");
    store.set(lastActivityAtom, Date.now() - 60000);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    // The zombie live-send is torn down with the sentinel reason so chat.ts reads
    // it as a hand-off (leave the turn streaming), not a user Stop.
    expect(abortSpy).toHaveBeenCalledWith(HANDOFF_ABORT_REASON);
  });

  it("removes the focus, pageshow, and heartbeat on unmount (no leak)", async () => {
    const store = createStore();
    const removeWin = vi.spyOn(window, "removeEventListener");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useReconnect(7, 42), {
      wrapper: wrapper(store),
    });
    await idleAfterProbe();

    unmount();
    expect(removeWin).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeWin).toHaveBeenCalledWith("pageshow", expect.any(Function));
    expect(clearSpy).toHaveBeenCalled();
  });

  it("a real keepalive resets the real stall watchdog; a silent socket trips it and reopens", async () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    expect(openReconnectStream).toHaveBeenCalledTimes(1);

    // Headers arrive → arm the 20s watchdog.
    act(() => {
      firstStream().options.onOpen?.();
    });

    // Five cycles of "advance 15s, then a keepalive" — each keepalive re-arms
    // the watchdog under its 20s window, so it must never fire.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      act(() => {
        firstStream().options.onLive?.();
      });
    }
    expect(openReconnectStream).toHaveBeenCalledTimes(1);

    // Now go silent past the window → stall fires → the manager aborts the
    // zombie itself.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(firstStream().options.signal.aborted).toBe(true);

    // The abort surfaces to the transport as a clean resolve (close) → backoff
    // → reopen.
    await act(async () => {
      firstStream().deferred.resolve();
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(openReconnectStream).toHaveBeenCalledTimes(2);
  });

  it("a done frame dismisses the reconnecting toast and exits to idle", async () => {
    const store = createStore();
    const { toast } = await import("@sico/ui");
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });

    act(() => {
      firstStream().options.onOpen?.();
    });
    act(() => {
      firstStream().options.onEvent(messageFrame(7, "hi"));
    });
    act(() => {
      firstStream().options.onEvent({ event: "done", data: {} });
    });

    expect(toast.dismiss).toHaveBeenCalledWith("chat-reconnect");

    // Close-echo asymmetry: the server then closes the (done) stream. That echo
    // must NOT re-enter the loop — no backoff reopen after a clean done.
    await act(async () => {
      firstStream().deferred.resolve();
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(openReconnectStream).toHaveBeenCalledTimes(1);
  });

  it("unmount aborts the in-flight controller and raises no error toast", async () => {
    const store = createStore();
    const { toast } = await import("@sico/ui");
    const { unmount } = renderHook(() => useReconnect(7, 42), {
      wrapper: wrapper(store),
    });
    const { signal } = firstStream().options;

    unmount();

    expect(signal.aborted).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    // A silent teardown: no reopen after time passes.
    await act(async () => {
      firstStream().deferred.resolve();
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(openReconnectStream).toHaveBeenCalledTimes(1);
  });

  it("a 401 from the reconnect stream triggers the logout flow and schedules no backoff", async () => {
    const store = createStore();
    renderHook(() => useReconnect(7, 42), { wrapper: wrapper(store) });
    const setSpy = vi.spyOn(store, "set");
    expect(openReconnectStream).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstStream().deferred.reject(new ChatStreamHttpError(401));
    });
    await flush();

    // The 401 routed to the C1 logout flow (the same atom the axios interceptor
    // writes), not the retry path.
    expect(setSpy).toHaveBeenCalledWith(logoutAtom);

    // No backoff: a dead session must not spin — advancing time opens nothing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(openReconnectStream).toHaveBeenCalledTimes(1);
  });

  it("forwards the latest from-head replay buffer to onReplay (coalesced, not doubled per frame)", () => {
    const store = createStore();
    const onReplay = vi.fn<(events: ChatEvent[]) => void>();
    renderHook(() => useReconnect(7, 42, { onReplay }), {
      wrapper: wrapper(store),
    });

    act(() => {
      firstStream().options.onOpen?.(); // resets the buffer
    });
    act(() => {
      firstStream().options.onEvent(messageFrame(7, "Hello"));
    });
    act(() => {
      firstStream().options.onEvent(messageFrame(7, " world"));
    });

    // The latest replay carries the WHOLE from-head run (2 frames), not an
    // ever-growing duplicate.
    const last = onReplay.mock.calls.at(-1)?.[0];
    expect(last).toHaveLength(2);
    expect(
      last?.map((e) => (e.event === "message" ? e.data.content : "")),
    ).toEqual(["Hello", " world"]);
  });

  it("stop() goes idle, dismisses the toast, and opens no new stream", async () => {
    const store = createStore();
    const { toast } = await import("@sico/ui");
    const { result } = renderHook(() => useReconnect(7, 42), {
      wrapper: wrapper(store),
    });

    // Observe a live turn, then a drop raises the toast and starts backoff.
    act(() => {
      firstStream().options.onOpen?.();
    });
    act(() => {
      firstStream().options.onEvent(messageFrame(7, "hi"));
    });
    await act(async () => {
      firstStream().deferred.resolve();
    });
    await flush();

    act(() => {
      result.current.stop();
    });

    expect(toast.dismiss).toHaveBeenCalledWith("chat-reconnect");

    // Hard exit: no reopen on the next backoff window.
    const callsAfterStop = vi.mocked(openReconnectStream).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(openReconnectStream).toHaveBeenCalledTimes(callsAfterStop);
  });
});
