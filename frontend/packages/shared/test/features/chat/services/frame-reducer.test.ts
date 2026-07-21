import { afterEach, describe, expect, it, vi } from "vitest";

import { type Message } from "@/features/chat/atoms/chat-atom";
import {
  reduceFrame,
  replayFrames,
} from "@/features/chat/services/frame-reducer";
import { logger } from "@/utils/logger";

// helper: build a one-AI-message draft; annotate so the literal type-checks
function aiDraft(content: Message["content"] = []): { history: Message[] } {
  return { history: [{ id: "ai", author: "ai", content }] };
}

// helper: read joined text with the union-narrow (precedent chat.test.ts:68)
const joinText = (m: Message): string =>
  m.content.map((p) => (p.type === "text" ? p.text : "")).join("");

describe("frame-reducer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("MARKDOWN frame appends a text part", () => {
    const draft = aiDraft();
    reduceFrame(draft, "ai", {
      event: "message",
      data: { type: 1, content: "Hello" },
    });
    reduceFrame(draft, "ai", {
      event: "message",
      data: { type: 1, content: " world" },
    });
    expect(joinText(draft.history[0]!)).toBe("Hello world");
  });

  it("PLAN frame creates exactly one plan part carrying turnId→planId", () => {
    const draft = aiDraft();
    reduceFrame(draft, "ai", {
      event: "message",
      data: { type: 9, content: "", turnId: 42 },
    });
    expect(draft.history[0]!.content).toEqual([
      { partId: expect.any(String), type: "plan", planId: "42" },
    ]);
  });

  it("reset-then-replay is idempotent vs a partial tail (no double-append)", () => {
    // tail already shows a partial "Hello wor"; a full from-head replay must
    // rebuild, never concatenate onto the stale tail.
    const draft = aiDraft([{ partId: "x", type: "text", text: "Hello wor" }]);
    replayFrames(draft, "ai", [
      { event: "message", data: { type: 1, content: "Hello" } },
      { event: "message", data: { type: 1, content: " wor" } },
      { event: "message", data: { type: 1, content: "ld" } },
    ]);
    expect(joinText(draft.history[0]!)).toBe("Hello world");
  });

  it("skips a KNOWN non-markdown frame (END=5): no part, logs at debug", () => {
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const draft = aiDraft();
    reduceFrame(draft, "ai", {
      event: "message",
      data: { type: 5, content: "" },
    });
    expect(draft.history[0]!.content).toHaveLength(0);
    expect(debug).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips an UNKNOWN (out-of-enum) frame (type=99): no part, logs at warn", () => {
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const draft = aiDraft();
    reduceFrame(draft, "ai", {
      event: "message",
      data: { type: 99, content: "???" },
    });
    expect(draft.history[0]!.content).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(debug).not.toHaveBeenCalled();
  });

  it("is a no-op when the target messageId is absent (does not throw)", () => {
    const draft = aiDraft();
    expect(() =>
      reduceFrame(draft, "missing", {
        event: "message",
        data: { type: 1, content: "x" },
      }),
    ).not.toThrow();
    expect(draft.history[0]!.content).toHaveLength(0);
  });

  it("ignores a terminal (done) frame — produces no Part", () => {
    // done/error are terminal signals owned by the orchestrator, not the
    // reducer; replayFrames stays a trivial fold even if a buffer holds one.
    const draft = aiDraft();
    reduceFrame(draft, "ai", { event: "done", data: { timestamp: 1 } });
    expect(draft.history[0]!.content).toHaveLength(0);
  });

  it("skips a PLAN frame missing turnId (no broken 'undefined' planId), logs warn", () => {
    // The streaming schema types turnId optional; minting planId:"undefined"
    // would make PlanCard poll GET /plan forever. Guard, don't mint.
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const draft = aiDraft();
    reduceFrame(draft, "ai", {
      event: "message",
      data: { type: 9, content: "" },
    });
    expect(draft.history[0]!.content).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("replayFrames is a no-op when the target messageId is absent", () => {
    const draft = aiDraft([{ partId: "x", type: "text", text: "keep" }]);
    expect(() =>
      replayFrames(draft, "missing", [
        { event: "message", data: { type: 1, content: "y" } },
      ]),
    ).not.toThrow();
    // the present message is untouched (not cleared)
    expect(joinText(draft.history[0]!)).toBe("keep");
  });

  // A reconnect resumes a turn whose persisted history row has NO client
  // `streamingState`; replayFrames restores it from the run so the composer can
  // tell the turn is still live. Terminal state is owned solely by `settleTurn`
  // (driven by the machine's terminal events), so the replay only ever asserts
  // `streaming` — never settles, never downgrades an already-settled turn.
  it("replayFrames marks an unsettled message streaming", () => {
    const draft = aiDraft();
    replayFrames(draft, "ai", [
      { event: "message", data: { type: 1, content: "partial" } },
    ]);
    expect(draft.history[0]!.streamingState).toBe("streaming");
  });

  it("replayFrames does not downgrade an already-settled (done) message to streaming", () => {
    // C1 race at the unit level: `settleTurn` marked the turn done before a
    // still-pending replay rAF fires. The late replay rebuilds content but must
    // NOT revert the terminal state, else the resumed turn wedges streaming.
    const draft = aiDraft();
    draft.history[0]!.streamingState = "done";
    replayFrames(draft, "ai", [
      { event: "message", data: { type: 1, content: "rebuilt" } },
    ]);
    expect(draft.history[0]!.streamingState).toBe("done");
  });

  it("replayFrames does not downgrade an already-settled (error) message to streaming", () => {
    const draft = aiDraft();
    draft.history[0]!.streamingState = "error";
    replayFrames(draft, "ai", [
      { event: "message", data: { type: 1, content: "rebuilt" } },
    ]);
    expect(draft.history[0]!.streamingState).toBe("error");
  });
});
