import { describe, expect, it } from "vitest";

import {
  chatEventSchema,
  chatStreamResponseSchema,
  MARKDOWN_CONTENT_TYPE,
} from "@/features/chat/schemas/chat-event";

describe("chatEventSchema", () => {
  it("parses a message frame (type=1 MARKDOWN text)", () => {
    const result = chatEventSchema.safeParse({
      event: "message",
      data: { type: MARKDOWN_CONTENT_TYPE, content: "hello", timestamp: 1 },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.event === "message") {
      expect(result.data.data.content).toBe("hello");
      expect(result.data.data.type).toBe(1);
    }
  });

  it("parses the real backend text frame (turnId is an int64 number, not a string)", () => {
    // Ground truth captured live from the backend:
    // data:{"type":1,"content":"Hi.","timestamp":1780788019865,"isFinal":false,"role":"assistant","turnId":1}
    const result = chatEventSchema.safeParse({
      event: "message",
      data: {
        type: 1,
        content: "Hi.",
        timestamp: 1780788019865,
        isFinal: false,
        role: "assistant",
        turnId: 1,
      },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.event === "message") {
      expect(result.data.data.content).toBe("Hi.");
      expect(result.data.data.turnId).toBe(1);
    }
  });

  it("keeps an unknown message `type` instead of dropping the frame", () => {
    const result = chatEventSchema.safeParse({
      event: "message",
      data: { type: 99, content: "" },
    });
    expect(result.success).toBe(true);
  });

  it("strips unknown extra fields (lenient) — reserved wire fields", () => {
    const parsed = chatStreamResponseSchema.parse({
      type: 1,
      content: "x",
      conversationId: 1,
      turnId: 1,
      role: "assistant",
      isFinal: true,
      somethingNew: 123,
    });
    expect("somethingNew" in parsed).toBe(false);
    expect(parsed.conversationId).toBe(1);
  });

  it("parses a done frame", () => {
    const result = chatEventSchema.safeParse({
      event: "done",
      data: { timestamp: 42 },
    });
    expect(result.success).toBe(true);
  });

  it("parses an error frame whose data is a bare string", () => {
    const result = chatEventSchema.safeParse({ event: "error", data: "boom" });
    expect(result.success).toBe(true);
    if (result.success && result.data.event === "error") {
      expect(result.data.data).toBe("boom");
    }
  });

  it("rejects an unknown event name", () => {
    const result = chatEventSchema.safeParse({ event: "keepalive", data: {} });
    expect(result.success).toBe(false);
  });

  it("parses a contentless non-text frame (backend omits empty content)", () => {
    // type:5 END frame — content omitted on the wire (Go omitempty); defaults to ""
    const result = chatEventSchema.safeParse({
      event: "message",
      data: {
        type: 5,
        timestamp: 1,
        isFinal: true,
        role: "assistant",
        turnId: 1,
      },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.event === "message") {
      expect(result.data.data.content).toBe("");
    }
  });

  it("rejects a message frame missing type", () => {
    const result = chatEventSchema.safeParse({
      event: "message",
      data: { content: "x" },
    });
    expect(result.success).toBe(false);
  });
});
