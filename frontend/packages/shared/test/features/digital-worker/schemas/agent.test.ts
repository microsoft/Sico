import { describe, expect, it } from "vitest";

import {
  agentSchema,
  AgentStatusSchema,
  EvaluationTaskStatusSchema,
} from "../../../../src/features/digital-worker/schemas/agent";

describe("agentSchema", () => {
  it("parses with iconUri present", () => {
    const parsed = agentSchema.parse({
      id: 1,
      name: "Helper",
      iconUri: "https://example.com/icon.png",
    });
    expect(parsed.iconUri).toBe("https://example.com/icon.png");
  });

  it("parses with iconUri absent", () => {
    const parsed = agentSchema.parse({ id: 2, name: "Helper" });
    expect(parsed.iconUri).toBeUndefined();
  });

  it("normalises empty-string iconUri to undefined", () => {
    const parsed = agentSchema.parse({ id: 5, name: "Helper", iconUri: "" });
    expect(parsed.iconUri).toBeUndefined();
  });

  it("passes site-relative iconUri through unchanged", () => {
    const parsed = agentSchema.parse({
      id: 7,
      name: "Helper",
      iconUri: "/assets/x.png",
    });
    expect(parsed.iconUri).toBe("/assets/x.png");
  });

  it("rejects missing id", () => {
    expect(() => agentSchema.parse({ name: "Helper" })).toThrow();
  });

  it("rejects non-string name", () => {
    expect(() => agentSchema.parse({ id: 1, name: 42 })).toThrow();
  });

  it("rejects non-string iconUri", () => {
    expect(() =>
      agentSchema.parse({ id: 1, name: "Helper", iconUri: 42 }),
    ).toThrow();
  });

  it("parses with role present (round-trip)", () => {
    const parsed = agentSchema.parse({
      id: 3,
      name: "Arena",
      role: "Legal Counsel",
    });
    expect(parsed.role).toBe("Legal Counsel");
  });

  it("parses with role absent", () => {
    const parsed = agentSchema.parse({ id: 4, name: "Max" });
    expect(parsed.role).toBeUndefined();
  });

  it("accepts id at MAX_SAFE_INTEGER", () => {
    const parsed = agentSchema.parse({
      id: Number.MAX_SAFE_INTEGER,
      name: "Helper",
    });
    expect(parsed.id).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects id above MAX_SAFE_INTEGER (int64 precision risk)", () => {
    expect(() =>
      agentSchema.parse({ id: 2 ** 53 + 1, name: "Helper" }),
    ).toThrow();
  });

  it("rejects negative updatedAt", () => {
    expect(() =>
      agentSchema.parse({ id: 1, name: "Helper", updatedAt: -1 }),
    ).toThrow();
  });
});

describe("agentSchema — landing page fields", () => {
  it("parses updatedAt as an epoch-ms number", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      updatedAt: 1779345587679,
    });
    expect(result.updatedAt).toBe(1779345587679);
  });

  it("rejects non-number updatedAt", () => {
    expect(() =>
      agentSchema.parse({ id: 1, name: "Chloe", updatedAt: "not-a-number" }),
    ).toThrow();
  });

  it("normalises empty employerIconUri to undefined", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      employerIconUri: "",
    });
    expect(result.employerIconUri).toBeUndefined();
  });

  it("accepts optional employerUsername", () => {
    const result = agentSchema.parse({ id: 1, name: "Chloe" });
    expect(result.employerUsername).toBeUndefined();
  });

  // The DW header popover's "Operator" row reads operatorUsername — a distinct
  // backend field from employerUsername (the DW's owner). Legacy's MorePopover
  // showed `agent.operatorUsername`; the migration dropped it and mis-bound the
  // row to employerUsername, so the popover showed the owner instead.
  it("parses operatorUsername", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      operatorUsername: "jialiang",
    });
    expect(result.operatorUsername).toBe("jialiang");
  });

  it("accepts optional operatorUsername", () => {
    const result = agentSchema.parse({ id: 1, name: "Chloe" });
    expect(result.operatorUsername).toBeUndefined();
  });
});

describe("agentSchema — status (DW card badge)", () => {
  it("parses a known status into the AgentStatus enum", () => {
    const result = agentSchema.parse({ id: 1, name: "Chloe", status: 3 });
    expect(result.status).toBe(AgentStatusSchema.enum.ACTIVE);
  });

  // Backend (Go) marshals an unset status as JSON `null`, not `undefined`.
  // `.nullish()` accepts it and preserves `null`; the card guards with
  // `status != null` so a display-only field can't fail the parse.
  it("accepts null status (Go zero-value marshaling)", () => {
    const result = agentSchema.parse({ id: 1, name: "Chloe", status: null });
    expect(result.status).toBeNull();
  });

  it("accepts absent status", () => {
    const result = agentSchema.parse({ id: 1, name: "Chloe" });
    expect(result.status).toBeUndefined();
  });

  // An int outside the enum (proto may add values) must degrade to "no
  // badge" via `.catch(undefined)`, never throw and nuke the whole list.
  it("degrades an out-of-enum status int to undefined (no throw)", () => {
    const result = agentSchema.parse({ id: 1, name: "Chloe", status: 6 });
    expect(result.status).toBeUndefined();
  });
});

describe("agentSchema — evaluationStatus (onboarding click branch)", () => {
  it("parses a known evaluationStatus into the EvaluationTaskStatus enum", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      evaluationStatus: 2,
    });
    expect(result.evaluationStatus).toBe(
      EvaluationTaskStatusSchema.enum.EVALUATED,
    );
  });

  // Go marshals an unset evaluation status as JSON `null`; `.nullish()`
  // accepts it. The onboarding branch guards with a null check.
  it("accepts null evaluationStatus (Go zero-value marshaling)", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      evaluationStatus: null,
    });
    expect(result.evaluationStatus).toBeNull();
  });

  it("accepts absent evaluationStatus", () => {
    const result = agentSchema.parse({ id: 1, name: "Chloe" });
    expect(result.evaluationStatus).toBeUndefined();
  });

  // An int outside the enum (proto may add values) must degrade via
  // `.catch(undefined)` rather than throw and nuke the whole list — same
  // display-resilience as `status`.
  it("degrades an out-of-enum evaluationStatus int to undefined (no throw)", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      evaluationStatus: 4,
    });
    expect(result.evaluationStatus).toBeUndefined();
  });
});

describe("agentSchema — project (DW card third row)", () => {
  it("parses project.name", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      project: { name: "SICO" },
    });
    expect(result.project?.name).toBe("SICO");
  });

  // The owning project's id drives "Add to project" from a deliverable preview
  // (POST /project/deliverable needs the projectId).
  it("parses project.id", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      project: { id: 84, name: "SICO" },
    });
    expect(result.project?.id).toBe(84);
  });

  // Go marshals an unset project struct as JSON `null`; `.nullish()` covers it.
  it("accepts null project (Go zero-value marshaling)", () => {
    const result = agentSchema.parse({ id: 1, name: "Chloe", project: null });
    expect(result.project).toBeNull();
  });

  it("accepts absent project", () => {
    const result = agentSchema.parse({ id: 1, name: "Chloe" });
    expect(result.project).toBeUndefined();
  });

  // The backend project object is larger than { id, name }; extra keys are
  // stripped, and a project with no name (all-partial) still parses.
  it("ignores extra project keys and tolerates a missing name", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      project: { id: 1, name: "SICO", description: "x" },
    });
    expect(result.project).toEqual({ id: 1, name: "SICO" });
  });

  // `project.id` is POSTed as the `projectId` address (POST /project/deliverable),
  // so it carries the same int64-precision risk as the agent's own `id` and uses
  // `.safe()`. An out-of-range id throws inside the object, and `.catch(undefined)`
  // degrades the whole project to undefined → "Add to project" disables, rather
  // than silently addressing the WRONG project with a precision-collapsed id.
  it("degrades a project.id above MAX_SAFE_INTEGER to undefined (no wrong-address)", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      project: { id: 2 ** 53 + 1, name: "SICO" },
    });
    expect(result.project).toBeUndefined();
  });

  it("accepts a project.id at MAX_SAFE_INTEGER", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      project: { id: Number.MAX_SAFE_INTEGER, name: "SICO" },
    });
    expect(result.project?.id).toBe(Number.MAX_SAFE_INTEGER);
  });

  // `.catch(undefined)` degrades a malformed project (e.g. non-string name)
  // to undefined rather than failing the whole `z.array(agentSchema)` parse —
  // a display-only field must never nuke the list (parity with `status`).
  it("degrades a malformed project to undefined (no throw)", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Chloe",
      project: { name: 123 },
    });
    expect(result.project).toBeUndefined();
  });
});

// `sandboxes` is the count the chat Device button gates on (length > 0). The
// element shape stays `unknown` — only the presence/count matters here.
describe("agentSchema — sandboxes (Device button gate)", () => {
  it("parses an array of sandboxes (length preserved)", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Max",
      sandboxes: [{ sandboxId: "a" }, { sandboxId: "b" }],
    });
    expect(result.sandboxes).toHaveLength(2);
  });

  it("parses an empty sandboxes array", () => {
    const result = agentSchema.parse({ id: 1, name: "Max", sandboxes: [] });
    expect(result.sandboxes).toEqual([]);
  });

  it("accepts null sandboxes (Go zero-value marshaling)", () => {
    const result = agentSchema.parse({ id: 1, name: "Max", sandboxes: null });
    expect(result.sandboxes).toBeNull();
  });

  it("accepts absent sandboxes", () => {
    const result = agentSchema.parse({ id: 1, name: "Max" });
    expect(result.sandboxes).toBeUndefined();
  });

  it("degrades a malformed sandboxes value to undefined (no throw)", () => {
    const result = agentSchema.parse({
      id: 1,
      name: "Max",
      sandboxes: "not-an-array",
    });
    expect(result.sandboxes).toBeUndefined();
  });
});
