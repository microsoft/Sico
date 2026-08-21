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
