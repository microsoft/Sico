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
  conversationListSchema,
  conversationSummarySchema,
  createConversationRequestSchema,
} from "../../../../src/features/chat/schemas/conversation";

describe("conversationSummarySchema", () => {
  it("parses a full conversation and flattens agentInstanceId", () => {
    const parsed = conversationSummarySchema.parse({
      id: 55,
      title: "First chat",
      createdAt: 1_700_000_000,
      agentInstanceInfo: { instanceId: 7 },
    });
    expect(parsed).toEqual({
      id: 55,
      title: "First chat",
      createdAt: 1_700_000_000,
      agentInstanceId: 7,
    });
  });

  it("defaults a missing title to an empty string", () => {
    const parsed = conversationSummarySchema.parse({ id: 1 });
    expect(parsed.title).toBe("");
  });

  it("leaves agentInstanceId undefined when agentInstanceInfo is null", () => {
    const parsed = conversationSummarySchema.parse({
      id: 1,
      agentInstanceInfo: null,
    });
    expect(parsed.agentInstanceId).toBeUndefined();
  });

  it("ignores unmodeled fields rather than rejecting", () => {
    const parsed = conversationSummarySchema.parse({
      id: 1,
      status: 3,
      metaData: { anything: true },
      creatorUsername: "me",
    });
    expect(parsed.id).toBe(1);
  });

  it("rejects a conversation with no id", () => {
    expect(() => conversationSummarySchema.parse({ title: "x" })).toThrow();
  });
});

describe("conversationListSchema", () => {
  it("parses the page array + hasMore flag", () => {
    const parsed = conversationListSchema.parse({
      conversations: [{ id: 1 }, { id: 2 }],
      hasMore: true,
    });
    expect(parsed.conversations).toHaveLength(2);
    expect(parsed.hasMore).toBe(true);
  });
});

describe("createConversationRequestSchema", () => {
  it("requires agentInstanceId and allows an optional title", () => {
    expect(
      createConversationRequestSchema.parse({ agentInstanceId: 7 }),
    ).toEqual({ agentInstanceId: 7 });
    expect(
      createConversationRequestSchema.parse({
        agentInstanceId: 7,
        title: "Hi",
      }),
    ).toEqual({ agentInstanceId: 7, title: "Hi" });
  });

  it("rejects a request with no agentInstanceId", () => {
    expect(() =>
      createConversationRequestSchema.parse({ title: "Hi" }),
    ).toThrow();
  });
});
