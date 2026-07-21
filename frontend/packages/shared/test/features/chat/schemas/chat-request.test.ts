import { describe, expect, it } from "vitest";

import {
  chatAttachmentRefSchema,
  chatRequestSchema,
} from "@/features/chat/schemas/chat-request";

describe("chatRequestSchema", () => {
  it("parses a text-only request with no attachments", () => {
    const result = chatRequestSchema.safeParse({
      agentInstanceId: 7,
      message: "hi",
      attachments: [],
    });
    expect(result.success).toBe(true);
  });

  it("parses a request carrying a ready attachment ref", () => {
    const ref = {
      name: "a.pdf",
      size: 10,
      type: "pdf",
      uri: "u",
      sasUrl: "s",
    };
    expect(chatAttachmentRefSchema.safeParse(ref).success).toBe(true);
    expect(
      chatRequestSchema.safeParse({
        agentInstanceId: 7,
        message: "",
        attachments: [ref],
      }).success,
    ).toBe(true);
  });

  it("rejects a request missing agentInstanceId", () => {
    expect(
      chatRequestSchema.safeParse({ message: "x", attachments: [] }).success,
    ).toBe(false);
  });
});
