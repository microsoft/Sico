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

import { z } from "zod";

// Plan-tree enums. Each crosses the parse boundary, so each is its own schema.
// Kept numeric — the wire integer is the single source of truth, mapped to labels
// at render time. They are three DISTINCT enums: `PlanStepStatus.PENDING = 1` and
// `ToolCallStatus.PENDING = 9` differ, so folding them would mis-validate.

export const PlanStatusSchema = z.enum({
  UNKNOWN: 0,
  NO_PLAN: 1,
  RUNNING: 2,
  COMPLETED: 3,
  FAILED: 4,
  REQUIRE_HUMAN_INPUT: 5,
  CANCELLED: 6,
});
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PlanStepStatusSchema = z.enum({
  UNKNOWN: 0,
  PENDING: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  FAILED: 4,
  REQUIRE_HUMAN_INPUT: 5,
  CANCELLED: 6,
});

// PENDING=9 is deliberately distinct from PlanStepStatus.PENDING=1.
export const ToolCallStatusSchema = z.enum({
  UNKNOWN: 0,
  RUNNING: 1,
  FAILED: 2,
  SUCCESSFUL: 3,
  FAILED_ANALYZING: 4,
  FAILED_ANALYZED: 5,
  RETRY_RUNNING: 6,
  RETRY_SUCCESSFUL: 7,
  RETRY_FAILED: 8,
  PENDING: 9,
});
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

// `ToolExecutionInfo`. C2 reads only `builtinToolName` (the plan card hides a
// tool's `message` when it is `run_tasks`). Optional — not every tool call ships it.
const toolExecutionInfoSchema = z.object({
  builtinToolName: z.string().optional(),
});

// The normalized `ToolCall`. Explicit type alias so the recursive `subCalls`
// resolves: `z.lazy` cannot infer a self-referential `.transform` output alone.
export type ToolCall = {
  // int64 wire id coerced to a string for a stable merge key. Does NOT recover
  // precision — an id >2^53 is already rounded by `JSON.parse`; acceptable
  // because these are sequential backend ids well under that bound.
  toolCallId: string;
  toolName: string;
  message?: string;
  status: ToolCallStatus;
  // Open `map<string,string>` — no key contract, unknown keys pass through.
  display?: Record<string, string>;
  executionInfo?: z.infer<typeof toolExecutionInfoSchema>;
  // C2 renders deliverable chips downstream but reads no field here — keep the
  // wire payload intact (`unknown`) rather than invent an unverified shape.
  deliverables?: unknown[];
  subCalls: ToolCall[];
};

// Parses the wire `ToolCall` → normalized: renames `toolCallStatus → status`,
// coerces the int64 id, recurses through `subCalls`. The `z.ZodType` + `z.lazy`
// is the canonical zod idiom for a self-referential transform.
export const toolCallSchema: z.ZodType<ToolCall> = z.lazy(() =>
  z
    .object({
      toolCallId: z.coerce.string(),
      toolName: z.string(),
      message: z.string().optional(),
      toolCallStatus: ToolCallStatusSchema,
      display: z.record(z.string(), z.string()).optional(),
      executionInfo: toolExecutionInfoSchema.optional(),
      deliverables: z.array(z.unknown()).optional(),
      subCalls: z.array(toolCallSchema).default([]),
    })
    .transform(
      ({ toolCallStatus, ...rest }): ToolCall => ({
        ...rest,
        status: toolCallStatus,
      }),
    ),
);

// Wire `PlanStep`: carries NO id on the wire — the parent `planSchema.transform`
// injects a positional `id`, so this schema keeps the raw wire shape only.
const planStepWireSchema = z.object({
  title: z.string(),
  status: PlanStepStatusSchema,
  toolCalls: z.array(toolCallSchema).default([]),
});

// The normalized `PlanStep`: the wire shape plus the synthesized `id`.
export type PlanStep = z.infer<typeof planStepWireSchema> & { id: string };

// `GET /plan` returns `data: { plan, status }` where `status` is a SIBLING of
// `plan`. The wire `Plan` has no top-level id. The `.transform`:
//   • `planId = String(plan.extra.turnId)` — the int64 turnId is the plan's id,
//     coerced to a string merge key (not precision-recovery: already rounded by
//     `JSON.parse`);
//   • the sibling `status` is folded onto the plan;
//   • each step gets a positional `id = String(index)` — the array index is the
//     stable key because plans append/update steps but never reorder them.
export type Plan = {
  planId: string;
  status: PlanStatus;
  title?: string;
  steps: PlanStep[];
};

export const planSchema = z
  .object({
    status: PlanStatusSchema,
    // `plan` is OPTIONAL: a NO_PLAN (status=1) response carries `{ status }`
    // alone, no `plan` body. Requiring it threw on every plan-less turn, and
    // `fetchPlan`'s reject drove an infinite 2s poll retry (use-plan catch path).
    plan: z
      .object({
        title: z.string().optional(),
        extra: z.object({ turnId: z.coerce.string() }),
        steps: z.array(planStepWireSchema).default([]),
      })
      .optional(),
  })
  // …but optional ONLY for NO_PLAN. Any other status with the plan body omitted
  // is off-contract — keep the boundary tight so an unconditional optional can't
  // swallow a malformed live response (a RUNNING turn must carry its tree).
  .superRefine((data, ctx) => {
    if (
      data.plan === undefined &&
      data.status !== PlanStatusSchema.enum.NO_PLAN
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["plan"],
        message: "plan body is required unless status is NO_PLAN",
      });
    }
  })
  .transform(
    ({ status, plan }): Plan => ({
      // No plan body → no turnId to derive an id from. The card keys off the
      // message's planId, not this field, so "" is inert here.
      planId: plan?.extra.turnId ?? "",
      status,
      title: plan?.title,
      steps: (plan?.steps ?? []).map((step, index) => ({
        ...step,
        id: String(index),
      })),
    }),
  );
