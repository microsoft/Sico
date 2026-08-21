import { describe, expect, it } from "vitest";

import { type ChatEvent } from "@/features/chat/schemas/chat-event";
import {
  type Command,
  initialState,
  type ReconnectMachineState,
  reduce,
} from "@/features/chat/services/reconnect";

// --- helpers ----------------------------------------------------------------

// A validated MARKDOWN data frame for turn `turnId`. Mirrors the wire shape the
// transport hands the machine (chat-event.ts) — type-safe, no casts.
function messageFrame(turnId: number, content: string): ChatEvent {
  return { event: "message", data: { type: 1, content, turnId } };
}

const DONE_FRAME: ChatEvent = { event: "done", data: { timestamp: 1 } };

// Collapse a commands array to its `type` tags for order-insensitive presence
// assertions.
function tags(commands: Command[]): Command["type"][] {
  return commands.map((c) => c.type);
}

// Count how many `openStream` commands a list carries — the single-flight
// invariant is "exactly one new stream", so this is the load-bearing metric.
function countOpens(commands: Command[]): number {
  return commands.filter((c) => c.type === "openStream").length;
}

// Drive a sequence of events from a start state, returning the final state and
// the FLAT list of every command emitted across the whole run (so single-flight
// can be asserted over the entire trigger burst, not just the last step).
function run(
  start: ReconnectMachineState,
  events: Parameters<typeof reduce>[1][],
): { state: ReconnectMachineState; commands: Command[] } {
  let state = start;
  const commands: Command[] = [];
  for (const event of events) {
    const step = reduce(state, event);
    state = step.next;
    commands.push(...step.commands);
  }
  return { state, commands };
}

describe("reconnect machine", () => {
  it("[11a] fires exactly one probe on entry", () => {
    const { next: state, commands } = reduce(initialState(), { type: "probe" });
    // A probe from idle opens exactly one stream and enters `reconnecting`.
    expect(countOpens(commands)).toBe(1);
    expect(state.phase).toBe("reconnecting");
  });

  it("[11a] single-flight: online+visible+backoff-tick together open only ONE stream", () => {
    // Open a stream (probe), then fire all three "immediate retry" triggers
    // while it is still in flight.
    const { commands } = run(initialState(), [
      { type: "probe" },
      { type: "online" },
      { type: "visible" },
      { type: "backoffTick" },
    ]);
    // The probe opened one; the three in-flight triggers must open ZERO more.
    expect(countOpens(commands)).toBe(1);
  });

  it("resume from idle opens exactly one stream (a retry trigger like probe/online/visible)", () => {
    // `resume` is the live-send→reconnect handoff trigger: the hook detects a
    // dead live stream and dispatches it to open a reconnect stream from idle.
    const { next: state, commands } = reduce(initialState(), {
      type: "resume",
    });
    expect(countOpens(commands)).toBe(1);
    expect(state.phase).toBe("reconnecting");
  });

  it("resume is single-flight: it opens NO second stream while one is in flight", () => {
    // A `resume` racing an already-open reconnect stream (e.g. focus + heartbeat
    // both fire) must be absorbed by the single-flight gate, not double-open.
    const { commands } = run(initialState(), [
      { type: "probe" },
      { type: "resume" },
    ]);
    expect(countOpens(commands)).toBe(1);
  });

  it("[11a] entry-probe failure before any turn observed retries silently (no toast)", () => {
    // probe → (no frame ever observed) → close. activeTurnId is still
    // undefined, so this is the first-load carve-out: schedule backoff, but
    // NEVER raise the toast.
    const { state, commands } = run(initialState(), [
      { type: "probe" },
      { type: "close" },
    ]);
    expect(tags(commands)).toContain("scheduleBackoff");
    expect(tags(commands)).not.toContain("showToast");
    expect(state.activeTurnId).toBeUndefined();
  });

  it("[11a] once a live turn is observed, a drop raises the persistent toast (stable id, not re-raised per attempt)", () => {
    // probe → frame (live turn observed) → close (drop) raises the toast.
    const first = run(initialState(), [
      { type: "probe" },
      { type: "frame", event: messageFrame(7, "hi") },
      { type: "close" },
    ]);
    expect(first.state.activeTurnId).toBe(7);
    expect(tags(first.commands)).toContain("showToast");

    // A second attempt cycle (backoffTick reopens → close again) must NOT
    // re-raise the toast — one persistent toast across attempts.
    const second = run(first.state, [
      { type: "backoffTick" },
      { type: "close" },
    ]);
    expect(tags(second.commands)).not.toContain("showToast");
  });

  it("[11a] backoff caps at 30s and never gives up", () => {
    // Walk many close→backoffTick cycles; the scheduled ms doubles 1s→2s→4s…
    // and saturates at 30000, never stopping (an openStream keeps coming). 12
    // cycles is enough to pass the cap: 1s doubles to 32s by the 6th close, so
    // by the 12th we have ≥6 saturated samples — proving the clamp holds, not
    // just that one value happened to land on 30000.
    let state = reduce(initialState(), { type: "probe" }).next;
    const scheduled: number[] = [];
    let opens = 0;
    for (let i = 0; i < 12; i++) {
      const closed = reduce(state, { type: "close" });
      state = closed.next;
      for (const c of closed.commands) {
        if (c.type === "scheduleBackoff") {
          scheduled.push(c.ms);
        }
      }
      const ticked = reduce(state, { type: "backoffTick" });
      state = ticked.next;
      opens += countOpens(ticked.commands);
    }
    expect(scheduled[0]).toBe(1000);
    expect(scheduled[1]).toBe(2000);
    expect(scheduled[2]).toBe(4000);
    // Saturates and never exceeds the cap.
    expect(Math.max(...scheduled)).toBe(30000);
    expect(scheduled.at(-1)).toBe(30000);
    // Every backoffTick reopened — the loop never gave up.
    expect(opens).toBe(12);
  });

  it("[11a] done dismisses the toast and exits to idle", () => {
    const { state, commands } = run(initialState(), [
      { type: "probe" },
      { type: "frame", event: messageFrame(7, "hi") },
      { type: "done", event: DONE_FRAME },
    ]);
    expect(state.phase).toBe("idle");
    expect(tags(commands)).toContain("dismissToast");
    expect(tags(commands)).toContain("idle");
    // A clean exit schedules no further retry.
    expect(tags(commands)).not.toContain("scheduleBackoff");
  });

  it("aborts the stream on a terminal done (no lingering socket if the backend holds it open)", () => {
    // Symmetric with stop/401/unmount: a terminal exit tears the transport down
    // itself rather than relying on the backend to close after the done frame.
    const { commands } = run(initialState(), [
      { type: "probe" },
      { type: "open" },
      { type: "frame", event: messageFrame(7, "hi") },
      { type: "done", event: DONE_FRAME },
    ]);
    expect(tags(commands)).toContain("abort");
  });

  it("aborts the stream on a terminal error", () => {
    const { commands } = run(initialState(), [
      { type: "probe" },
      { type: "open" },
      { type: "frame", event: messageFrame(7, "hi") },
      { type: "error" },
    ]);
    expect(tags(commands)).toContain("abort");
  });

  it("settles the resumed turn to done on a terminal done frame", () => {
    // A frame records the live turnId; the done frame then settles that turn —
    // the hook marks the AI message done (no sendMessage closure after reload).
    const { commands } = run(initialState(), [
      { type: "probe" },
      { type: "frame", event: messageFrame(7, "hi") },
      { type: "done", event: DONE_FRAME },
    ]);
    const settle = commands.filter((c) => c.type === "settle").at(-1);
    expect(settle).toEqual({ type: "settle", turnId: 7, state: "done" });
  });

  it("settles the resumed turn to done on user stop", () => {
    const { commands } = run(initialState(), [
      { type: "probe" },
      { type: "frame", event: messageFrame(7, "hi") },
      { type: "stop" },
    ]);
    const settle = commands.filter((c) => c.type === "settle").at(-1);
    expect(settle).toEqual({ type: "settle", turnId: 7, state: "done" });
  });

  it("settles the resumed turn to error on a terminal error frame", () => {
    const { state, commands } = run(initialState(), [
      { type: "probe" },
      { type: "frame", event: messageFrame(7, "hi") },
      { type: "error" },
    ]);
    expect(state.phase).toBe("idle");
    const settle = commands.filter((c) => c.type === "settle").at(-1);
    expect(settle).toEqual({ type: "settle", turnId: 7, state: "error" });
  });

  it("emits no settle when no turn was ever observed (nothing to settle)", () => {
    // probe → done with no frame: activeTurnId stayed undefined, so there's no
    // AI message to mark — the machine must not emit a settle.
    const { commands } = run(initialState(), [
      { type: "probe" },
      { type: "done", event: DONE_FRAME },
    ]);
    expect(tags(commands)).not.toContain("settle");
  });

  it("[11a] reconnect rebuilds turn content (reset-then-replay), never double-appends", () => {
    // First stream delivers a partial turn, then drops.
    const dropped = run(initialState(), [
      { type: "probe" },
      { type: "open" },
      { type: "frame", event: messageFrame(7, "Hello") },
      { type: "frame", event: messageFrame(7, " wor") },
      { type: "close" },
    ]);
    // The reconnect stream replays the WHOLE turn from head plus the tail.
    const replayed = run(dropped.state, [
      { type: "backoffTick" },
      { type: "open" },
      { type: "frame", event: messageFrame(7, "Hello") },
      { type: "frame", event: messageFrame(7, " wor") },
      { type: "frame", event: messageFrame(7, "ld") },
    ]);
    // `open` resets the buffer; the replay carries the full from-head run, so
    // the replay command's frames rebuild to three — NOT five (no double-append).
    const replay = replayed.commands.filter((c) => c.type === "replay").at(-1);
    expect(replay).toBeDefined();
    expect(replay?.events).toHaveLength(3);
    expect(
      replay?.events.map((e) => (e.event === "message" ? e.data.content : "")),
    ).toEqual(["Hello", " wor", "ld"]);
  });

  // G2 — the zombie-stream wedge (RED first; single-flight tests pass while this fails):
  it("[11a] a stalled stream (open, no frames, no close) trips the stall timer and the loop opens a fresh stream", () => {
    // Feed {open} then {stallTimeout} with NO {frame}/{keepalive} between.
    const stalled = run(initialState(), [{ type: "probe" }, { type: "open" }]);
    // open arms the watchdog.
    expect(tags(stalled.commands)).toContain("armStall");

    const tripped = reduce(stalled.state, { type: "stallTimeout" });
    // The machine aborts the zombie itself.
    expect(tags(tripped.commands)).toContain("abort");

    // That abort surfaces as a close, which (not a stop) reopens via backoff →
    // exactly one NEW stream.
    const closed = reduce(tripped.next, { type: "close" });
    const ticked = reduce(closed.next, { type: "backoffTick" });
    expect(countOpens(ticked.commands)).toBe(1);
  });

  it("[11a] a keepalive resets the stall timer (a quiet-but-alive stream is NOT aborted)", () => {
    // Feed {open} then repeated {keepalive} → machine re-arms, never aborts.
    const { commands } = run(initialState(), [
      { type: "probe" },
      { type: "open" },
      { type: "keepalive" },
      { type: "keepalive" },
      { type: "keepalive" },
    ]);
    // Every keepalive re-arms the watchdog…
    expect(
      tags(commands).filter((t) => t === "armStall").length,
    ).toBeGreaterThanOrEqual(4);
    // …and none of them aborts the (alive) stream.
    expect(tags(commands)).not.toContain("abort");
  });

  // G4 — Stop is a hard idle exit, not a retry trigger:
  it("[11a] stop() goes idle, dismisses the toast, and schedules NO backoff", () => {
    // A live, reconnecting stream, then the user presses Stop.
    const live = run(initialState(), [
      { type: "probe" },
      { type: "frame", event: messageFrame(7, "hi") },
      { type: "close" },
    ]);
    const stopped = run(live.state, [
      { type: "backoffTick" },
      { type: "stop" },
    ]);
    expect(tags(stopped.commands)).toContain("abort");
    expect(tags(stopped.commands)).toContain("dismissToast");
    expect(stopped.state.phase).toBe("idle");
    expect(tags(stopped.commands)).not.toContain("scheduleBackoff");

    // The abort that Stop requested surfaces as a close — and because Stop set
    // the exiting flag, that close must NOT re-enter the loop (no backoff, no
    // reopen).
    const afterClose = reduce(stopped.state, { type: "close" });
    expect(tags(afterClose.commands)).not.toContain("scheduleBackoff");
    expect(countOpens(afterClose.commands)).toBe(0);
    expect(afterClose.next.phase).toBe("idle");
  });

  it("[11a] a transport close (not stop) DOES schedule backoff and stays in the loop", () => {
    const { state, commands } = run(initialState(), [
      { type: "probe" },
      { type: "frame", event: messageFrame(7, "hi") },
      { type: "close" },
    ]);
    expect(tags(commands)).toContain("scheduleBackoff");
    // Still in the loop, not idle.
    expect(state.phase).toBe("reconnecting");
  });

  it("[11a] a stallTimeout with nothing in flight is a no-op (no spurious abort)", () => {
    // The watchdog can fire after a close already tore the stream down (timer
    // race). With inFlight false there is nothing to abort — the machine must
    // emit no command and leave state untouched, NOT abort a dead stream.
    const idle = run(initialState(), [{ type: "probe" }, { type: "close" }]);
    expect(idle.state.inFlight).toBe(false);
    const tripped = reduce(idle.state, { type: "stallTimeout" });
    expect(tripped.commands).toHaveLength(0);
    expect(tripped.next).toBe(idle.state);
  });

  it("[11a] unmount aborts and drops the loop silently (no backoff, no toast)", () => {
    // A live, reconnecting stream, then the component unmounts.
    const live = run(initialState(), [
      { type: "probe" },
      { type: "frame", event: messageFrame(7, "hi") },
    ]);
    const unmounted = reduce(live.state, { type: "unmount" });
    expect(tags(unmounted.commands)).toContain("abort");
    expect(tags(unmounted.commands)).toContain("idle");
    // Silent teardown: no retry scheduled, no toast raised or dismissed.
    expect(tags(unmounted.commands)).not.toContain("scheduleBackoff");
    expect(tags(unmounted.commands)).not.toContain("showToast");
    expect(unmounted.next.phase).toBe("idle");
    expect(unmounted.next.activeTurnId).toBeUndefined();
  });

  // 401 — a dead session exits the loop (no backoff, no toast) and triggers the C1 logout flow:
  it("[11a] http401 emits logout + idle and schedules NO backoff", () => {
    const { state, commands } = run(initialState(), [
      { type: "probe" },
      { type: "http401" },
    ]);
    expect(tags(commands)).toContain("logout");
    expect(tags(commands)).toContain("idle");
    expect(state.phase).toBe("idle");
    expect(tags(commands)).not.toContain("scheduleBackoff");
    expect(tags(commands)).not.toContain("showToast");
  });
});
