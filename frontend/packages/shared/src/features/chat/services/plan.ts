import type { AxiosInstance } from "axios";
import { castDraft, type Draft, produce } from "immer";
import { z } from "zod";

import { HTTP_OK } from "../../../constants/http";
import { apiResponseSchema, unwrapData } from "../../../schemas/api";
import {
  type Plan,
  planSchema,
  type PlanStep,
  type ToolCall,
} from "../schemas/plan";

export type PlanParams = {
  agentInstanceId: number;
  turnId: number;
  // Required: the plan is addressed by (agentInstanceId, turnId, conversationId).
  // Omitting it forces the backend to guess the conversation from the turn,
  // which is ambiguous (turnId restarts per conversation) → NO_PLAN. 0 is the
  // legacy "no conversation" sentinel.
  conversationId: number;
};

const planEnvelopeSchema = apiResponseSchema(planSchema);

export async function fetchPlan(
  apiClient: AxiosInstance,
  { agentInstanceId, turnId, conversationId }: PlanParams,
): Promise<Plan> {
  const res = await apiClient.get<unknown>("/conversation/plan", {
    params: { agentInstanceId, turnId, conversationId },
  });
  const parsed = planEnvelopeSchema.parse(res.data);
  // Rejects a non-OK code first, then requires `data` — both surface as a
  // ZodError → schema bucket in `classifyError`.
  return unwrapData(parsed, "fetchPlan");
}

// `CancelPlanResponse` carries no `data` — validate the envelope shape, then
// branch on `code`.
const cancelEnvelopeSchema = apiResponseSchema(z.unknown());

export async function cancelPlan(
  apiClient: AxiosInstance,
  { agentInstanceId, turnId, conversationId }: PlanParams,
): Promise<void> {
  const res = await apiClient.post<unknown>("/conversation/plan/cancel", {
    agentInstanceId,
    turnId,
    conversationId,
  });
  const envelope = cancelEnvelopeSchema.safeParse(res.data);
  if (!envelope.success) {
    throw new Error("cancelPlan: malformed envelope");
  }
  if (envelope.data.code !== HTTP_OK) {
    throw new Error("cancelPlan: server rejected");
  }
}

// Structural equality for the open, schema-less wire payloads. These arrive as
// fresh refs every poll, so comparing first lets `mergePlan` skip the write and
// preserve the draft's reference when content is unchanged. JSON round-trip is
// sufficient: both sides are bounded JSON-origin payloads from the same
// backend, so key order is stable across polls.
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// Reconcile a draft array against `fresh` BY id, in place. Identity is
// preserved in the no-op case: an unchanged matched element keeps its slot
// (`draft[i] === target[i]`), so immer leaves the array (and ancestors)
// untouched. Only differing slots are written; a removed id is dropped because
// the rebuilt order follows `fresh`, the authoritative latest.
function reconcileChildren<T extends object>(
  draft: Draft<T>[],
  freshArr: readonly T[],
  keyOf: (item: Draft<T> | T) => string,
  reconcileItem: (draftItem: Draft<T>, freshItem: T) => void,
): void {
  const byId = new Map<string, Draft<T>>();
  for (const item of draft) {
    byId.set(keyOf(item), item);
  }
  const target: Draft<T>[] = freshArr.map((freshItem) => {
    const existing = byId.get(keyOf(freshItem));
    if (existing) {
      reconcileItem(existing, freshItem);
      return existing;
    }
    // New id: `castDraft` is immer's sanctioned identity cast for a plain node.
    return castDraft(freshItem);
  });
  for (let i = 0; i < target.length; i++) {
    if (draft[i] !== target[i]) {
      draft[i] = target[i]!;
    }
  }
  if (draft.length > target.length) {
    draft.length = target.length;
  }
}

// Reconcile one tool call: scalars assigned only when changed (a guarded `!==`
// — assigning `undefined` to an ABSENT optional key is a structural write in
// immer that dirties an unchanged node), open fields only when deep-changed,
// then recurse `subCalls` by id.
function reconcileToolCall(draft: Draft<ToolCall>, fresh: ToolCall): void {
  if (draft.toolName !== fresh.toolName) {
    draft.toolName = fresh.toolName;
  }
  if (draft.message !== fresh.message) {
    draft.message = fresh.message;
  }
  if (draft.status !== fresh.status) {
    draft.status = fresh.status;
  }
  if (!jsonEqual(draft.display, fresh.display)) {
    draft.display = fresh.display;
  }
  if (!jsonEqual(draft.executionInfo, fresh.executionInfo)) {
    draft.executionInfo = fresh.executionInfo;
  }
  if (!jsonEqual(draft.deliverables, fresh.deliverables)) {
    draft.deliverables = fresh.deliverables;
  }
  reconcileChildren<ToolCall>(
    draft.subCalls,
    fresh.subCalls,
    (tc) => tc.toolCallId,
    reconcileToolCall,
  );
}

function reconcileStep(draft: Draft<PlanStep>, fresh: PlanStep): void {
  if (draft.title !== fresh.title) {
    draft.title = fresh.title;
  }
  if (draft.status !== fresh.status) {
    draft.status = fresh.status;
  }
  // `id` is the match key, so a matched draft step always equals fresh — never
  // written.
  reconcileChildren<ToolCall>(
    draft.toolCalls,
    fresh.toolCalls,
    (tc) => tc.toolCallId,
    reconcileToolCall,
  );
}

// Pure immer reconciler: merge `fresh` INTO `prev` by id so every unchanged
// node keeps its object identity (`===`) across polls, while a changed node —
// and only its ancestors — gets a new ref. This is the render gate for the
// per-node `React.memo` plan tree: an all-unchanged poll returns `prev` itself.
export function mergePlan(prev: Plan, fresh: Plan): Plan {
  return produce(prev, (draft) => {
    if (draft.status !== fresh.status) {
      draft.status = fresh.status;
    }
    if (draft.title !== fresh.title) {
      draft.title = fresh.title;
    }
    if (draft.planId !== fresh.planId) {
      draft.planId = fresh.planId;
    }
    reconcileChildren<PlanStep>(
      draft.steps,
      fresh.steps,
      (step) => step.id,
      reconcileStep,
    );
  });
}
