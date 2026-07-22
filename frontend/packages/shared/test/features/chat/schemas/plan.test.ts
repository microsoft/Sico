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
  planSchema,
  toolCallSchema,
  ToolCallStatusSchema,
} from "@/features/chat/schemas/plan";

describe("planSchema", () => {
  it("parses the wire plan and normalizes to §8 (step → toolCall → subCalls)", () => {
    const parsed = planSchema.parse({
      status: 2, // PlanStatus.RUNNING — sibling of plan
      plan: {
        title: "Build it",
        extra: { turnId: 42 },
        steps: [
          {
            title: "Build",
            status: 1,
            toolCalls: [
              {
                toolCallId: 1,
                toolName: "run_tasks",
                toolCallStatus: 9,
                subCalls: [
                  {
                    toolCallId: 2,
                    toolName: "fetch",
                    toolCallStatus: 2,
                    subCalls: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(parsed.planId).toBe("42"); // String(extra.turnId)
    expect(parsed.status).toBe(2); // folded sibling
    expect(parsed.steps[0]?.id).toBe("0"); // synthesized positional
    expect(parsed.steps[0]?.toolCalls[0]?.toolCallId).toBe("1"); // int64 → String
    expect(parsed.steps[0]?.toolCalls[0]?.status).toBe(9); // toolCallStatus → status (PENDING=9)
    expect(parsed.steps[0]?.toolCalls[0]?.subCalls[0]?.toolName).toBe("fetch");
  });

  it("defaults omitted steps and toolCalls to [] (lenient defaults fire on undefined)", () => {
    const noSteps = planSchema.parse({
      status: 2,
      plan: { extra: { turnId: 1 } },
    });
    expect(noSteps.steps).toEqual([]);

    const noToolCalls = planSchema.parse({
      status: 2,
      plan: { extra: { turnId: 1 }, steps: [{ title: "s", status: 1 }] },
    });
    expect(noToolCalls.steps[0]?.toolCalls).toEqual([]);
  });

  it("leaves omitted plan.title undefined (optional, not defaulted)", () => {
    const parsed = planSchema.parse({
      status: 2,
      plan: { extra: { turnId: 1 } },
    });
    expect(parsed.title).toBeUndefined();
  });

  it("parses a NO_PLAN envelope that omits the plan body (real wire shape for turns with no plan)", () => {
    // Captured wire `data` for a historical turn with no plan tree:
    // `{ status: 1 }` — NO_PLAN with NO `plan` key. The schema must accept it
    // (plan optional) instead of throwing on a missing `plan`, else `fetchPlan`
    // rejects and the poll retries forever.
    const parsed = planSchema.parse({ status: 1 });
    expect(parsed.status).toBe(1); // NO_PLAN
    expect(parsed.steps).toEqual([]); // nothing to render
    expect(parsed.planId).toBe(""); // no plan body → no turnId to derive an id
    expect(parsed.title).toBeUndefined();
  });

  it("rejects a non-NO_PLAN status that omits the plan body (off-contract)", () => {
    // `plan` is optional ONLY because NO_PLAN legitimately omits it. A RUNNING /
    // COMPLETED / etc. envelope with no `plan` body is genuinely off-contract and
    // must still be rejected — keep the boundary tight, don't let an unconditional
    // optional swallow a malformed live response.
    expect(planSchema.safeParse({ status: 2 }).success).toBe(false); // RUNNING, no plan
    expect(planSchema.safeParse({ status: 3 }).success).toBe(false); // COMPLETED, no plan
  });
});

describe("toolCallSchema", () => {
  it("display is an open string map; the unknown key survives the transform", () => {
    const parsed = toolCallSchema.parse({
      toolCallId: 7,
      toolName: "x",
      toolCallStatus: 9,
      subCalls: [],
      display: { any_key: "v" },
    });
    expect(parsed.display?.any_key).toBe("v");
  });

  it("defaults omitted subCalls to [] (lenient default fires on undefined)", () => {
    const parsed = toolCallSchema.parse({
      toolCallId: 7,
      toolName: "x",
      toolCallStatus: 9,
    });
    expect(parsed.subCalls).toEqual([]);
  });
});

describe("ToolCallStatusSchema", () => {
  it("includes PENDING=9 (distinct from PlanStepStatus.PENDING=1)", () => {
    expect(ToolCallStatusSchema.parse(9)).toBe(9);
  });
});
