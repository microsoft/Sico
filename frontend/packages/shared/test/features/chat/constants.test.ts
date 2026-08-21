import { describe, expect, it } from "vitest";

import { MAX_ATTACHMENT_BYTES } from "@/features/chat/constants";

describe("chat constants", () => {
  it("caps attachments at exactly 16 MiB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_ATTACHMENT_BYTES).toBe(16_777_216);
  });
});
