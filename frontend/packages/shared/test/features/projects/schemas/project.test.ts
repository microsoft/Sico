import { describe, expect, it } from "vitest";

import {
  MemberTypeSchema,
  projectAgentInstanceSchema,
  projectSchema,
} from "../../../../src/features/projects/schemas/project";

describe("MemberTypeSchema", () => {
  it("accepts the legacy numeric values", () => {
    expect(MemberTypeSchema.parse(1)).toBe(1);
    expect(MemberTypeSchema.parse(2)).toBe(2);
    expect(MemberTypeSchema.parse(3)).toBe(3);
  });

  it("rejects other numbers", () => {
    expect(() => MemberTypeSchema.parse(0)).toThrow();
    expect(() => MemberTypeSchema.parse(4)).toThrow();
  });
});

describe("projectAgentInstanceSchema", () => {
  it("reads the wire `agentIconUrl` and exposes it as `iconUrl`", () => {
    const parsed = projectAgentInstanceSchema.parse({
      id: 1,
      agentIconUrl: "u",
    });
    expect(parsed.iconUrl).toBe("u");
  });

  it("coerces a missing agentIconUrl to an empty string", () => {
    // The backend may omit `agentIconUrl` entirely (or send null); the schema
    // normalises absence to "" rather than rejecting the whole project.
    const parsed = projectAgentInstanceSchema.parse({ id: 1 });
    expect(parsed.iconUrl).toBe("");
  });
});

describe("projectSchema", () => {
  const valid = {
    id: 42,
    name: "Atlas",
    description: "desc",
    iconUrl: "https://cdn.example/x.png",
    memberType: 3,
    agentInstances: [{ id: 1, agentIconUrl: "a" }],
  };

  it("accepts a full project payload and strips unknown fields", () => {
    const parsed = projectSchema.parse({
      ...valid,
      ownerUsername: "alice",
      createdAt: 0,
    });
    // `agentInstances[].agentIconUrl` is exposed to consumers as `iconUrl`.
    expect(parsed).toEqual({
      ...valid,
      agentInstances: [{ id: 1, iconUrl: "a" }],
    });
  });

  it("rejects a non-numeric memberType", () => {
    expect(() =>
      projectSchema.parse({ ...valid, memberType: "owner" }),
    ).toThrow();
  });

  it("rejects memberType: 0 (Go zero-value — list schema stays strict; only detail tolerates it)", () => {
    expect(() => projectSchema.parse({ ...valid, memberType: 0 })).toThrow();
  });

  it("defaults agentInstances to [] when omitted", () => {
    const parsed = projectSchema.parse({ ...valid, agentInstances: undefined });
    expect(parsed.agentInstances).toEqual([]);
  });

  it("coerces agentInstances null → [] (Go marshals an empty slice as JSON null)", () => {
    const parsed = projectSchema.parse({ ...valid, agentInstances: null });
    expect(parsed.agentInstances).toEqual([]);
  });
});
