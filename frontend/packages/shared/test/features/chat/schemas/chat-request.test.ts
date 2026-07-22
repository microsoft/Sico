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
