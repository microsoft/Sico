import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Plan } from "../../../../src/features/chat/schemas/plan";
import {
  cancelPlan,
  fetchPlan,
  mergePlan,
} from "../../../../src/features/chat/services/plan";

function makeGetClient(response: unknown): AxiosInstance {
  return {
    get: vi.fn().mockResolvedValue({ data: response }),
  } as Partial<AxiosInstance> as AxiosInstance;
}

function makePostClient(response: unknown): AxiosInstance {
  return {
    post: vi.fn().mockResolvedValue({ data: response }),
  } as Partial<AxiosInstance> as AxiosInstance;
}

// A minimal WIRE GetPlanData payload (`{ status, plan: { extra:{turnId}, steps } }`)
// shaped exactly as planSchema parses it: int ids, `toolCallStatus`, nested
// `subCalls`. Status ints: PlanStatus.RUNNING=2, PlanStepStatus.IN_PROGRESS=2,
// ToolCallStatus.RUNNING=1.
const wirePlanData = {
  status: 2,
  plan: {
    title: "Plan",
    extra: { turnId: 5 },
    steps: [
      {
        title: "Step",
        status: 2,
        toolCalls: [
          {
            toolCallId: 1,
            toolName: "search",
            toolCallStatus: 1,
            display: { k: "v" },
            subCalls: [
              {
                toolCallId: 2,
                toolName: "inner",
                toolCallStatus: 1,
                subCalls: [],
              },
            ],
          },
        ],
      },
    ],
  },
};

// A normalized Plan (the OUTPUT of planSchema, the shape mergePlan operates on):
// plan → 1 step "0" → toolCall "t1" (→ subCall "t2") + toolCall "t3" (→ subCall
// "t4"). The "t3/t4" branch is the untouched-subtree control for the isolation
// test. Built fresh per call so every node is a distinct object reference.
function makePlan(): Plan {
  return {
    planId: "5",
    status: 2,
    title: "Plan",
    steps: [
      {
        id: "0",
        title: "Step",
        status: 2,
        toolCalls: [
          {
            toolCallId: "t1",
            toolName: "search",
            status: 1,
            display: { k: "v" },
            subCalls: [
              {
                toolCallId: "t2",
                toolName: "inner",
                status: 1,
                display: { a: "b" },
                subCalls: [],
              },
            ],
          },
          {
            toolCallId: "t3",
            toolName: "other",
            status: 3,
            subCalls: [
              { toolCallId: "t4", toolName: "leaf", status: 3, subCalls: [] },
            ],
          },
        ],
      },
    ],
  };
}

describe("fetchPlan", () => {
  it("requests /conversation/plan with agentInstanceId + turnId and returns the normalized Plan", async () => {
    const client = makeGetClient({ code: 0, msg: "ok", data: wirePlanData });
    const result = await fetchPlan(client, {
      agentInstanceId: 7,
      turnId: 5,
      conversationId: 3,
    });
    expect(client.get).toHaveBeenCalledWith("/conversation/plan", {
      params: { agentInstanceId: 7, turnId: 5, conversationId: 3 },
    });
    expect(result.planId).toBe("5");
    expect(result.status).toBe(2);
    expect(result.steps[0]!.id).toBe("0");
    const t1 = result.steps[0]!.toolCalls[0]!;
    expect(t1.toolCallId).toBe("1");
    expect(t1.status).toBe(1);
    expect(t1.subCalls[0]!.toolCallId).toBe("2");
  });

  it("throws a ZodError when the envelope has a non-zero code and no data", async () => {
    const client = makeGetClient({ code: 500, msg: "boom" });
    // The ZodError TYPE is load-bearing: `classifyError` buckets it as "schema".
    // A regression to `throw new Error(...)` would still match the regex but
    // mis-bucket — so pin the instance, not just the message. `unwrapData`
    // rejects the non-OK code first, surfacing the real failure code.
    await expect(
      fetchPlan(client, { agentInstanceId: 1, turnId: 5, conversationId: 3 }),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      fetchPlan(client, { agentInstanceId: 1, turnId: 5, conversationId: 3 }),
    ).rejects.toThrow(/rejected \(code 500\)/);
  });

  it("resolves a NO_PLAN envelope whose data omits the plan body", async () => {
    // Captured real wire: `{ data: { status: 1 }, code: 0 }` — a successful
    // (code 0) NO_PLAN response with NO `plan` key. This MUST resolve, not
    // reject: rejecting drove an infinite 2s retry on every plan-less turn.
    const client = makeGetClient({
      code: 0,
      msg: "success",
      data: { status: 1 },
    });
    const result = await fetchPlan(client, {
      agentInstanceId: 7,
      turnId: 14,
      conversationId: 3,
    });
    expect(result.status).toBe(1); // NO_PLAN
    expect(result.steps).toEqual([]);
    expect(result.planId).toBe(""); // no plan body → no turnId to derive an id
  });
});

describe("cancelPlan", () => {
  it("POSTs /conversation/plan/cancel with agentInstanceId + turnId and resolves on code 0", async () => {
    const client = makePostClient({ code: 0, msg: "ok" });
    await expect(
      cancelPlan(client, { agentInstanceId: 7, turnId: 5, conversationId: 3 }),
    ).resolves.toBeUndefined();
    expect(client.post).toHaveBeenCalledWith("/conversation/plan/cancel", {
      agentInstanceId: 7,
      turnId: 5,
      conversationId: 3,
    });
  });

  it("throws when the server returns a non-zero code", async () => {
    const client = makePostClient({ code: 500, msg: "boom" });
    await expect(
      cancelPlan(client, { agentInstanceId: 1, turnId: 5, conversationId: 3 }),
    ).rejects.toThrow(/server rejected/);
  });

  it("throws when the envelope is malformed", async () => {
    const client = makePostClient("not an envelope");
    await expect(
      cancelPlan(client, { agentInstanceId: 1, turnId: 5, conversationId: 3 }),
    ).rejects.toThrow(/malformed envelope/);
  });
});

describe("mergePlan", () => {
  it("by-id merge keeps unchanged node object identity across polls", () => {
    const prev = makePlan();
    const step0Before = prev.steps[0]!;
    const t1Before = prev.steps[0]!.toolCalls[0]!;
    const t2Before = prev.steps[0]!.toolCalls[0]!.subCalls[0]!;

    const next = mergePlan(prev, structuredClone(prev));

    // Nothing changed → the whole tree (every level) keeps its reference.
    expect(next).toBe(prev);
    expect(next.steps[0]!).toBe(step0Before);
    expect(next.steps[0]!.toolCalls[0]!).toBe(t1Before);
    expect(next.steps[0]!.toolCalls[0]!.subCalls[0]!).toBe(t2Before);
  });

  it("a changed sub-call status updates only that node; an unrelated subtree keeps identity", () => {
    const prev = makePlan();
    const t2Before = prev.steps[0]!.toolCalls[0]!.subCalls[0]!;
    const t3Before = prev.steps[0]!.toolCalls[1]!;
    const t4Before = prev.steps[0]!.toolCalls[1]!.subCalls[0]!;

    const fresh = structuredClone(prev);
    // Change ONLY t2's status (RUNNING=1 → SUCCESSFUL=3).
    fresh.steps[0]!.toolCalls[0]!.subCalls[0]!.status = 3;

    const next = mergePlan(prev, fresh);

    const t2After = next.steps[0]!.toolCalls[0]!.subCalls[0]!;
    expect(t2After).not.toBe(t2Before);
    expect(t2After.status).toBe(3);
    // The parallel t3/t4 branch was untouched → both keep identity.
    expect(next.steps[0]!.toolCalls[1]!).toBe(t3Before);
    expect(next.steps[0]!.toolCalls[1]!.subCalls[0]!).toBe(t4Before);
  });

  it("a changed display payload mints a new ref for that node only", () => {
    const prev = makePlan();
    const t1Before = prev.steps[0]!.toolCalls[0]!;
    const t3Before = prev.steps[0]!.toolCalls[1]!;

    const fresh = structuredClone(prev);
    fresh.steps[0]!.toolCalls[0]!.display = { k: "changed" };

    const next = mergePlan(prev, fresh);

    expect(next.steps[0]!.toolCalls[0]!).not.toBe(t1Before);
    expect(next.steps[0]!.toolCalls[0]!.display).toEqual({ k: "changed" });
    // Sibling untouched.
    expect(next.steps[0]!.toolCalls[1]!).toBe(t3Before);
  });

  it("reconciles plan-level scalars: changed status updates the plan but keeps unchanged step refs", () => {
    const prev = makePlan();
    const step0Before = prev.steps[0]!;

    const fresh = structuredClone(prev);
    fresh.status = 3; // RUNNING=2 → COMPLETED=3

    const next = mergePlan(prev, fresh);

    expect(next).not.toBe(prev);
    expect(next.status).toBe(3);
    expect(next.title).toBe(prev.title);
    expect(next.steps[0]!).toBe(step0Before);
  });

  it("adds new nodes and drops removed nodes, in fresh order", () => {
    const prev = makePlan();
    const t4Before = prev.steps[0]!.toolCalls[1]!.subCalls[0]!;

    // Added: a new subCall "t5" under t1. Removed: t2 (t1's existing subCall).
    const fresh = structuredClone(prev);
    fresh.steps[0]!.toolCalls[0]!.subCalls = [
      { toolCallId: "t5", toolName: "added", status: 1, subCalls: [] },
    ];

    const next = mergePlan(prev, fresh);

    const subCalls = next.steps[0]!.toolCalls[0]!.subCalls;
    expect(subCalls).toHaveLength(1);
    expect(subCalls[0]!.toolCallId).toBe("t5");
    // The untouched t3/t4 branch still keeps identity.
    expect(next.steps[0]!.toolCalls[1]!.subCalls[0]!).toBe(t4Before);
  });
});
