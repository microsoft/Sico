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

import { assertNever } from "../../../utils/assert-never";
import { type TerminalStreamingState } from "../atoms/chat-atom";
import { type ChatEvent } from "../schemas/chat-event";

// The reconnect lifecycle as a PURE, React-free, timer-free, store-free state
// machine: `reduce(state, event) → { next, commands }`. Every correctness gate
// (single-flight, backoff cap, stall decision, stop-vs-close, 401-exit,
// reset-then-replay) is decided HERE and unit-tested with no DOM and no timers.
// The React adapter (`hooks/use-reconnect.ts`) owns the real
// timers/listeners/transport and executes the emitted commands.

const FIRST_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

// The hook feeds these (DOM/timer/transport events mapped to this vocabulary).
export type ReconnectEvent =
  | { type: "probe" } // entry trigger / "connect now"
  | { type: "open" } // SSE headers arrived (transport onOpen)
  | { type: "frame"; event: ChatEvent } // a validated data frame (transport onEvent)
  | { type: "keepalive" } // a keepalive frame — liveness only, no content
  | { type: "close" } // stream ended (onerror/close, or a requested abort)
  | { type: "http401" } // ChatStreamHttpError(401) — dead session
  | { type: "stallTimeout" } // the hook's stall watchdog fired
  | { type: "stop" } // user pressed Stop
  | { type: "online" } // window online
  | { type: "visible" } // retained trigger vocabulary; the hook now routes visibilitychange through the resume gate instead (see use-reconnect), so this is currently dispatched only in tests
  | { type: "resume" } // live-send→reconnect handoff: the hook saw a dead live stream
  | { type: "backoffTick" } // the hook's backoff timer elapsed
  | { type: "done"; event: ChatEvent } // terminal done frame (turn finished)
  | { type: "error" } // terminal error frame (turn failed)
  | { type: "unmount" }; // the hook is tearing down

// The machine's ONLY output — the hook executes each (drives reconnect-stream,
// real timers, the toast, and `store.set(logoutAtom)`).
export type Command =
  | { type: "openStream" }
  | { type: "scheduleBackoff"; ms: number }
  | { type: "armStall" }
  | { type: "clearStall" }
  | { type: "abort" }
  | { type: "showToast" }
  | { type: "dismissToast" }
  | { type: "logout" }
  | { type: "idle" }
  | { type: "replay"; events: ChatEvent[] }
  // Settle the resumed turn's AI message to a terminal state: a reconnect-driven
  // turn has no `sendMessage` closure to mark it (that closure died on the
  // reload), so the machine's own terminal events (`done`/`error` frame, user
  // `stop`) drive the settle — symmetric with the live-send path. The hook
  // resolves the turnId to the AI message and writes `streamingState`. `error`
  // also raises the failure toast (parity with the live-send error branch).
  | { type: "settle"; turnId: number; state: TerminalStreamingState };

export type ReconnectMachineState = {
  // --- public projection ---------------------------------------------------
  phase: "idle" | "reconnecting";
  attempt: number;
  activeTurnId?: number;
  // --- internal bookkeeping ------------------------------------------------
  // Single-flight gate: a stream is open. While true, a retry trigger is a
  // machine no-op — the hook resets its OWN backoff timer; the machine reopens
  // nothing.
  inFlight: boolean;
  // Next backoff delay; doubles per close, capped at MAX_BACKOFF_MS.
  backoffMs: number;
  // Set by `stop` before the abort so the resulting close exits cleanly instead
  // of re-entering the loop. ONLY `stop` arms this, because Stop is the one exit
  // where the hook stays wired and must absorb the abort's echo `close`.
  // `http401`/`done`/`unmount` are terminal teardowns — the hook stops feeding
  // events, so no echo `close` reaches the machine (an invariant the hook must
  // uphold: a `close` fed to a fresh idle state would re-arm the loop).
  exiting: boolean;
  // Stable-id toast idempotency: raise once per drop episode, not per attempt.
  toastShown: boolean;
  // reset-then-replay buffer: `open` clears it, each `frame` appends; the
  // machine hands the WHOLE buffer back via `replay` so the hook rebuilds from
  // head (no wire seq → rebuild, never double-append). Cumulative on purpose:
  // each `replay` is last-write-wins, so the hook coalesces (apply latest, drop
  // stale) and stays O(N) — an incremental `append` couldn't be dropped and
  // would force one store write per frame, O(N²).
  buffer: ChatEvent[];
};

export function initialState(): ReconnectMachineState {
  return {
    phase: "idle",
    attempt: 0,
    inFlight: false,
    backoffMs: FIRST_BACKOFF_MS,
    exiting: false,
    toastShown: false,
    buffer: [],
  };
}

type Step = { next: ReconnectMachineState; commands: Command[] };

// Open a fresh stream: enter `reconnecting`, mark in-flight, arm the stall
// watchdog, and reset the replay buffer. Used by every trigger allowed through
// the single-flight gate.
function openStream(state: ReconnectMachineState): Step {
  return {
    next: {
      ...state,
      phase: "reconnecting",
      inFlight: true,
      exiting: false,
      buffer: [],
    },
    commands: [{ type: "openStream" }, { type: "armStall" }],
  };
}

// A retry trigger (probe / online / visible / resume / backoffTick) —
// single-flight: open only when nothing is in flight; otherwise no-op (the hook
// resets the real backoff timer on its own; the machine opens no second stream).
function onTrigger(state: ReconnectMachineState): Step {
  if (state.inFlight) {
    return { next: state, commands: [] };
  }
  return openStream(state);
}

// A data frame: record the live turn, append to the replay buffer, and re-arm
// the stall watchdog.
function onFrame(state: ReconnectMachineState, event: ChatEvent): Step {
  // Only a message frame can carry a (still optional) turnId; the single `??`
  // is the whole rule: a message with no turnId keeps the prior one, never
  // clobbers it to undefined.
  const activeTurnId =
    event.event === "message"
      ? (event.data.turnId ?? state.activeTurnId)
      : state.activeTurnId;
  const buffer = [...state.buffer, event];
  return {
    next: { ...state, activeTurnId, buffer },
    commands: [{ type: "armStall" }, { type: "replay", events: buffer }],
  };
}

// A transport close. Stop-initiated (exiting) → clean idle, no backoff. Else
// schedule capped backoff and, if a live turn was observed, raise the single
// persistent toast (stable id → only the first drop of an episode shows it).
function onClose(state: ReconnectMachineState): Step {
  if (state.exiting) {
    return { next: initialState(), commands: [] };
  }
  const commands: Command[] = [
    { type: "clearStall" },
    { type: "scheduleBackoff", ms: state.backoffMs },
  ];
  const showToast = state.activeTurnId !== undefined && !state.toastShown;
  if (showToast) {
    commands.push({ type: "showToast" });
  }
  return {
    next: {
      ...state,
      phase: "reconnecting",
      inFlight: false,
      backoffMs: Math.min(state.backoffMs * 2, MAX_BACKOFF_MS),
      attempt: state.attempt + 1,
      toastShown: state.toastShown || showToast,
    },
    commands,
  };
}

// The stall watchdog fired on a zombie stream (open, silent, no close). Abort
// it ourselves; the abort surfaces as a `close`, which the loop then retries.
function onStallTimeout(state: ReconnectMachineState): Step {
  if (!state.inFlight) {
    return { next: state, commands: [] };
  }
  return { next: state, commands: [{ type: "abort" }] };
}

// A resumed turn's settle, if one is live. A reconnect-driven turn has no
// `sendMessage` closure to mark it, so every terminal handler that observed a
// turn (`activeTurnId`) settles its AI message — see the `settle` command.
// Returns `[]` when nothing was being resumed, so callers can spread it
// unconditionally.
function settleCommands(
  state: ReconnectMachineState,
  terminal: TerminalStreamingState,
): Command[] {
  if (state.activeTurnId === undefined) {
    return [];
  }
  return [{ type: "settle", turnId: state.activeTurnId, state: terminal }];
}

// User Stop: hard idle exit. Flip `exiting` so the resulting close stays idle,
// abort the in-flight stream, dismiss the toast, schedule NO backoff. If a turn
// was being resumed (`activeTurnId`), settle its AI message to `done` — the
// reconnect-driven turn has no `sendMessage` closure to do it.
function onStop(state: ReconnectMachineState): Step {
  return {
    next: { ...initialState(), exiting: true },
    commands: [
      { type: "abort" },
      { type: "clearStall" },
      { type: "dismissToast" },
      { type: "idle" },
      ...settleCommands(state, "done"),
    ],
  };
}

// A 401 means the session is dead: re-POSTing forever would spin. Exit via the
// auth-expiry flow (logout), no backoff, no toast (a re-auth prompt).
function onHttp401(): Step {
  return {
    next: initialState(),
    commands: [
      { type: "abort" },
      { type: "clearStall" },
      { type: "logout" },
      { type: "idle" },
    ],
  };
}

// Terminal `done`/`error`: the turn finished (cleanly / failed). Abort the
// stream ourselves (symmetric with stop/401/unmount — don't rely on the backend
// to close after the terminal frame), exit to idle, dismiss the toast, and
// settle the resumed turn's AI message. `error` settles to `error`, whose hook
// settle also raises the failure toast (parity with the live-send branch).
function onTerminal(
  state: ReconnectMachineState,
  terminal: TerminalStreamingState,
): Step {
  return {
    next: initialState(),
    commands: [
      { type: "abort" },
      { type: "clearStall" },
      { type: "dismissToast" },
      { type: "idle" },
      ...settleCommands(state, terminal),
    ],
  };
}

// Unmount: abort and drop the loop silently (no toast, no backoff).
function onUnmount(): Step {
  return {
    next: initialState(),
    commands: [{ type: "abort" }, { type: "clearStall" }, { type: "idle" }],
  };
}

export function reduce(
  state: ReconnectMachineState,
  event: ReconnectEvent,
): Step {
  switch (event.type) {
    case "probe":
    case "online":
    case "visible":
    case "resume":
    case "backoffTick":
      return onTrigger(state);
    case "open":
      // Headers arrived: (re)arm the watchdog and reset the replay buffer for
      // the from-head replay the backend is about to send.
      return {
        next: { ...state, buffer: [] },
        commands: [{ type: "armStall" }],
      };
    case "frame":
      return onFrame(state, event.event);
    case "keepalive":
      // Liveness only — re-arm the watchdog so a quiet-but-alive stream is never
      // aborted.
      return { next: state, commands: [{ type: "armStall" }] };
    case "close":
      return onClose(state);
    case "http401":
      return onHttp401();
    case "stallTimeout":
      return onStallTimeout(state);
    case "stop":
      return onStop(state);
    case "done":
      return onTerminal(state, "done");
    case "error":
      return onTerminal(state, "error");
    case "unmount":
      return onUnmount();
    default:
      // Exhaustive union: assertNever turns a future unhandled event type into
      // a compile error rather than a silent no-op transition.
      return assertNever(event);
  }
}
