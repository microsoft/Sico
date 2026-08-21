import { z } from "zod";

// Backend `AgentStatus` (single_agent_instance.proto). Values are the wire
// integers — do not renumber. Modeled as a `z.enum` (the lint bans TS
// `enum`), mirroring `MemberTypeSchema`; access members via
// `AgentStatusSchema.enum.ACTIVE`. Drives the optional status indicator on
// the DW card (shown only when SicoConfig.digitalWorkerCardShowStatus is on).
export const AgentStatusSchema = z.enum({
  UNKNOWN: 0,
  ONBOARDING: 1,
  NEW: 2,
  ACTIVE: 3,
  INACTIVE: 4,
  ABORTED: 5,
  ONBOARDING_SAVED: 7,
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

// Backend `EvaluationTaskStatus` (evaluation.proto). Wire integers — do not
// renumber. Modeled as a `z.enum` (the lint bans TS `enum`); access members
// via `EvaluationTaskStatusSchema.enum.EVALUATED`. Drives the DW card's
// onboarding click branch (evaluated → performance, evaluating → executing,
// unspecified → onboarding wizard).
export const EvaluationTaskStatusSchema = z.enum({
  UNSPECIFIED: 0,
  EVALUATING: 1,
  EVALUATED: 2,
  FAILED: 3,
});
export type EvaluationTaskStatus = z.infer<typeof EvaluationTaskStatusSchema>;

// Backend may send "", a relative path, or an absolute http(s) URL for
// icon fields. We normalise "" → undefined at the schema boundary so
// consumers can rely on truthy-check / `??` for absence; the scheme
// allow-list still lives in `safeIconUri` at render time.
const iconUrlSchema = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);

export const agentSchema = z.object({
  // Backend entity id is `int64` (mirrors `userSchema.id`).
  // `.safe()` rejects values above 2^53-1 where JS Number loses
  // precision — surfacing the error UI is correct, since we cannot
  // address the entity reliably.
  id: z.number().int().safe(),
  name: z.string(),
  // Role label rendered after name in DW rows.
  role: z.string().optional(),
  iconUri: iconUrlSchema,
  // Backend sends epoch ms (number). Used by `selectDedupedAgents` as the
  // dedup tie-break (keep the higher `updatedAt` when an id repeats).
  updatedAt: z.number().int().nonnegative().safe().optional(),
  // Employer (the DW's owner). Parsed to model the backend contract — the
  // wire payload always carries these — but no sico view reads them today
  // (the card's bottom row moved to `project.name`). Retained for the
  // exported `Agent` type's downstream consumers.
  employerUsername: z.string().optional(),
  employerIconUri: iconUrlSchema,
  // Operator (the user the DW is assigned to) — a DISTINCT field from
  // employerUsername (the owner). The collaboration header popover's "Operator"
  // row reads this; legacy's MorePopover bound the row to `operatorUsername`.
  operatorUsername: z.string().optional(),
  // Lifecycle status — drives the optional status badge / NEW dot on the
  // DW card (gated by SicoConfig.digitalWorkerCardShowStatus). Backend
  // sends `null` for unset status (Go zero-value marshaling); `.nullish()`
  // accepts null|undefined. `.catch(undefined)` degrades any out-of-enum
  // int (proto may add values) to "no badge" rather than failing the whole
  // `z.array(agentSchema)` parse — a display-only field must never nuke the list.
  status: AgentStatusSchema.nullish().catch(undefined),
  // Evaluation progress (onboarding flow). Drives the DW card's onboarding
  // click branch: evaluated → performance, evaluating → executing,
  // unspecified → onboarding wizard. Same display-resilient nullish/catch as
  // `status` — a bad value degrades the branch, never nukes the list parse.
  evaluationStatus: EvaluationTaskStatusSchema.nullish().catch(undefined),
  // Owning project. The card shows `project.name`; `project.id` drives "Add to
  // project" from a deliverable preview (POST /project/deliverable). `project.id`
  // is `.safe()` like the agent's own `id` — it's an int64 entity address, so it
  // carries the same >2^53 precision risk; an out-of-range id throws inside the
  // object and `.catch(undefined)` degrades the whole project to undefined (→ the
  // button disables) rather than addressing the wrong project. `.nullish()`
  // because Go marshals an unset project struct as JSON `null`; `.catch(undefined)`
  // also degrades a malformed project to "no row" rather than failing the whole
  // `z.array(agentSchema)` parse — same display-only resilience as `status`.
  project: z
    .object({ id: z.number().int().safe(), name: z.string() })
    .partial()
    .nullish()
    .catch(undefined),
  // Live device sandboxes attached to this agent. The handler always populates
  // `instance.sandboxes` (`single_agent.go:322`); the chat Device button only
  // needs the COUNT to decide whether to show the entry (legacy gated it on
  // `agent.sandboxes.length > 0`), so the elements stay `unknown` — the
  // `/sandbox/instance` poll owns the full shape. `.nullish()` for Go's null
  // zero-value, `.catch(undefined)` so a malformed value degrades to "no
  // button" rather than failing the whole agent parse.
  sandboxes: z.array(z.unknown()).nullish().catch(undefined),
});

export type Agent = z.infer<typeof agentSchema>;
