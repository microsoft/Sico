import { describe, expect, it } from "vitest";

import {
  messageAttachmentSchema,
  messageItemSchema,
} from "@/features/chat/schemas/message-item";

describe("messageItemSchema", () => {
  it("normalizes a MARKDOWN item to a text Part; role user → human", () => {
    const parsed = messageItemSchema.parse({
      messageId: 5,
      turnId: 7,
      role: "user",
      type: 1,
      content: "hi",
      createdAt: 1700,
    });
    expect(parsed).toEqual({
      id: "5",
      author: "human",
      content: [{ partId: "5:0", type: "text", text: "hi" }],
      turnId: 7,
      createdAt: 1700,
    });
    expect(parsed.attachments).toBeUndefined(); // no wire attachments → omitted
  });

  it("parses a PLAN item's inline content into a plan Part + seedPlan; role assistant → ai", () => {
    const inline = JSON.stringify({
      status: 3, // COMPLETED
      plan: {
        title: "Do the thing",
        extra: { turnId: 42 },
        steps: [{ title: "Step", status: 3, toolCalls: [] }],
      },
    });
    const parsed = messageItemSchema.parse({
      messageId: 8,
      turnId: 42,
      role: "assistant",
      type: 9,
      content: inline,
    });
    expect(parsed.author).toBe("ai");
    expect(parsed.content).toEqual([
      { partId: "8:0", type: "plan", planId: "42" },
    ]);
    expect(parsed.seedPlan?.planId).toBe("42");
    expect(parsed.seedPlan?.status).toBe(3);
    expect(parsed.seedPlan?.steps).toHaveLength(1);
  });

  it("emits NO plan Part and no seedPlan when a PLAN item's content is empty (backend did not inline)", () => {
    const parsed = messageItemSchema.parse({
      messageId: 8,
      turnId: 42,
      role: "assistant",
      type: 9,
      content: "",
    });
    expect(parsed.content).toEqual([]);
    expect(parsed.seedPlan).toBeUndefined();
  });

  it("emits NO plan Part and no seedPlan when a PLAN item's content is malformed (no throw)", () => {
    const parsed = messageItemSchema.parse({
      messageId: 8,
      turnId: 42,
      role: "assistant",
      type: 9,
      content: "not json",
    });
    expect(parsed.content).toEqual([]);
    expect(parsed.seedPlan).toBeUndefined();
  });

  it("emits NO plan Part and no seedPlan for a bodyless NO_PLAN inline (schema-valid but planId is empty)", () => {
    // `planSchema` accepts `{ status: 1 }` (NO_PLAN, no `plan` body) because
    // GET /conversation/plan legitimately returns it — but its `planId`
    // degenerates to "" (no `plan.extra.turnId`). Minting a plan Part with
    // planId "" would seed plansAtom under the "" sentinel and make PlanCard
    // poll turn 0, so an empty planId must be treated as absent.
    const parsed = messageItemSchema.parse({
      messageId: 8,
      turnId: 42,
      role: "assistant",
      type: 9,
      content: '{"status":1}',
    });
    expect(parsed.content).toEqual([]);
    expect(parsed.seedPlan).toBeUndefined();
  });

  it("maps attachments, coercing the numeric wire id to a string", () => {
    const parsed = messageItemSchema.parse({
      messageId: 5,
      turnId: 7,
      role: "user",
      type: 1,
      content: "see file",
      createdAt: 1700,
      attachments: [
        {
          name: "a.pdf",
          uri: "u",
          sasUrl: "s",
          type: "pdf",
          size: 100,
          id: 99,
        },
      ],
    });
    expect(parsed.attachments?.[0]).toEqual({
      name: "a.pdf",
      uri: "u",
      sasUrl: "s",
      type: "pdf",
      size: 100,
      id: "99",
    });
  });

  it("parses an experience item (type=8) into experienceCount, content empty", () => {
    const parsed = messageItemSchema.parse({
      messageId: 25,
      turnId: 10,
      role: "assistant",
      type: 8,
      content: '{"numOperations": 2, "playbookId": 1}',
    });
    expect(parsed.content).toEqual([]);
    expect(parsed.experienceCount).toBe(2);
  });

  it("parses the experience payload's playbookId (View more → playbook detail)", () => {
    const parsed = messageItemSchema.parse({
      messageId: 25,
      turnId: 10,
      role: "assistant",
      type: 8,
      content: '{"numOperations": 2, "playbookId": 7}',
    });
    expect(parsed.experiencePlaybookId).toBe(7);
  });

  it("omits experiencePlaybookId when the payload carries no playbookId", () => {
    const parsed = messageItemSchema.parse({
      messageId: 25,
      turnId: 10,
      role: "assistant",
      type: 8,
      content: '{"numOperations": 2}',
    });
    expect(parsed.experienceCount).toBe(2);
    expect(parsed.experiencePlaybookId).toBeUndefined();
  });

  it("omits experiencePlaybookId when playbookId is non-positive (invalid asset id)", () => {
    const parsed = messageItemSchema.parse({
      messageId: 25,
      turnId: 10,
      role: "assistant",
      type: 8,
      content: '{"numOperations": 2, "playbookId": 0}',
    });
    expect(parsed.experiencePlaybookId).toBeUndefined();
  });

  it("tolerates a malformed experience payload (no experienceCount, no throw)", () => {
    const parsed = messageItemSchema.parse({
      messageId: 26,
      turnId: 11,
      role: "assistant",
      type: 8,
      content: "not json",
    });
    expect(parsed.content).toEqual([]);
    expect(parsed.experienceCount).toBeUndefined();
    expect(parsed.experiencePlaybookId).toBeUndefined();
  });

  it("maps an unrendered content type (END=5) to empty content, no throw", () => {
    const parsed = messageItemSchema.parse({
      messageId: 3,
      turnId: 1,
      role: "assistant",
      type: 5,
      content: "",
    });
    expect(parsed.content).toEqual([]);
  });

  it("defaults omitted content to a text Part with empty text (Go omitempty)", () => {
    const parsed = messageItemSchema.parse({
      messageId: 6,
      turnId: 2,
      role: "user",
      type: 1,
    });
    expect(parsed.content).toEqual([{ partId: "6:0", type: "text", text: "" }]);
  });

  it("coerces a JSON null attachments slice to omitted (backend sends null, not [])", () => {
    // Real /conversation/messages payload: the backend serialises an assistant
    // turn's empty attachments slice as JSON `null` (same Go-slice quirk as
    // `roles` in auth.ts), so a strict `z.array(...)` would reject the whole
    // page. `.default([])` only fills `undefined`, never `null`.
    const parsed = messageItemSchema.parse({
      messageId: 223,
      turnId: 2,
      role: "assistant",
      type: 1,
      content: "ok",
      attachments: null,
    });
    expect(parsed.attachments).toBeUndefined();
  });

  it("rejects an unknown role rather than silently defaulting", () => {
    expect(
      messageItemSchema.safeParse({
        messageId: 1,
        turnId: 1,
        role: "system",
        type: 1,
        content: "x",
      }).success,
    ).toBe(false);
  });
});

describe("messageAttachmentSchema", () => {
  it("round-trips a wire attachment, coercing numeric id to string", () => {
    const parsed = messageAttachmentSchema.parse({
      name: "a.pdf",
      uri: "u",
      sasUrl: "s",
      type: "pdf",
      size: 100,
      id: 99,
    });
    expect(parsed.id).toBe("99");
  });

  it("accepts an attachment without an id (the field is optional)", () => {
    const parsed = messageAttachmentSchema.parse({
      name: "a.pdf",
      uri: "u",
      type: "pdf",
      size: 100,
    });
    expect(parsed.id).toBeUndefined();
  });
});
