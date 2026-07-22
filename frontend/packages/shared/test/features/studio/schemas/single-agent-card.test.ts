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
  agentInfosPayloadSchema,
  singleAgentCardSchema,
} from "@/features/studio/schemas/single-agent-card";

describe("singleAgentCardSchema", () => {
  it("parses a full card", () => {
    const card = singleAgentCardSchema.parse({
      agentId: "abc-123",
      name: "Atlas",
      role: "Researcher",
      creatorUsername: "alice",
      capabilityTags: ["search"],
    });
    expect(card).toEqual({
      agentId: "abc-123",
      name: "Atlas",
      role: "Researcher",
      creatorUsername: "alice",
      capabilityTags: ["search"],
    });
  });

  it("allows optional role/creator/tags to be absent", () => {
    const card = singleAgentCardSchema.parse({ agentId: "x", name: "Nova" });
    expect(card).toEqual({ agentId: "x", name: "Nova" });
  });

  it("drops a malformed capabilityTags instead of throwing", () => {
    const card = singleAgentCardSchema.parse({
      agentId: "x",
      name: "Nova",
      capabilityTags: "not-an-array",
    });
    expect(card.capabilityTags).toBeUndefined();
  });
});

describe("agentInfosPayloadSchema", () => {
  it("unwraps agentInfos into a bare array", () => {
    const list = agentInfosPayloadSchema.parse({
      agentInfos: [
        { agentId: "1", name: "A" },
        { agentId: "2", name: "B" },
      ],
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ agentId: "1", name: "A" });
  });

  it("defaults a missing agentInfos to an empty array", () => {
    expect(agentInfosPayloadSchema.parse({})).toEqual([]);
  });
});
