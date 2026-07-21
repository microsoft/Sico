import { z } from "zod";

import {
  EXPERIENCE_CONTENT_TYPE,
  MARKDOWN_CONTENT_TYPE,
  PLAN_CONTENT_TYPE,
} from "./chat-event";
import { chatAttachmentRefSchema } from "./chat-request";
import { type Plan, planSchema } from "./plan";
import { logger } from "../../../utils/logger";
import { type Message, type Part } from "../atoms/chat-atom";

// One conversation-history attachment: a ready send ref plus an int64 `id` the
// history item carries but the send payload drops. The SINGLE SOURCE for the
// store's `MessageAttachment` type. Wire `id` is a number; store-facing type is
// `id?: string`, so `z.coerce.string()` bridges it (stable merge key, as plan.ts).
export const messageAttachmentSchema = chatAttachmentRefSchema.extend({
  id: z.coerce.string().optional(),
});
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

// ACE experience item (type=8): `content` is a JSON blob `{numOperations,
// playbookId}`. Parsed leniently — a malformed blob yields `undefined`, never a
// throw. `playbookId` is independently optional + positive-int guarded so a
// missing/non-positive id leaves `View more` inert without blocking the count.
const experiencePayloadSchema = z.object({
  numOperations: z.number(),
  playbookId: z.coerce.number().int().positive().optional(),
});

function parseExperiencePayload(
  content: string,
): { numOperations: number; playbookId?: number } | undefined {
  try {
    const parsed = experiencePayloadSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined; // non-JSON content → no experience, deliberately swallowed
  }
}

// A type-9 history row inlines the plan tree as a JSON string in `content`,
// shaped exactly like `GET /conversation/plan`'s data (`{ status, plan }`), so
// `planSchema` parses it directly. Returns `undefined` (→ no plan Part, no seed,
// no poll) rather than throwing, so a bad plan never drops the turn:
//   • empty / non-JSON content → `JSON.parse` throws → caught below;
//   • schema-invalid content → `warn` (a backend contract drift worth seeing),
//     then `undefined`;
//   • a bodyless NO_PLAN (`{ status: 1 }`) parses but yields `planId: ""` (no
//     `plan.extra.turnId`). That "" would seed `plansAtom` under the no-plan
//     sentinel and make PlanCard poll turn 0, so an empty id is treated as absent.
function parseInlinePlan(content: string): Plan | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return undefined; // empty / non-JSON content → no plan, deliberately swallowed
  }
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("chat: inline plan failed schema", {
      issues: parsed.error.issues,
    });
    return undefined;
  }
  return parsed.data.planId === "" ? undefined : parsed.data;
}

// Parses ONE backend `MessageItem` and `.transform`s it into the store's
// normalized `Message`. Raw wire in, normalized model out (mirrors plan.ts).
//   • `messageId` → `Message.id`, coerced to a string (stable identity for the
//     by-id history dedup, same rationale as plan.ts `toolCallId`).
//   • `role` is a strict enum so an unknown value REJECTS rather than defaulting.
//   • `type` is a plain number (not strict) so an unrendered/future code yields
//     empty content instead of dropping the item.
//   • `turnId` is REQUIRED here (no `omitempty` on the wire) — load-bearing for
//     history identity and turn-grouping (`groupTurns` folds rows by turnId). A
//     PLAN item's `planId` comes from the inline payload's `plan.extra.turnId`
//     (via `planSchema`), not this field. Diverges from the streaming frame,
//     where turnId is `.optional()` because a mid-stream frame may omit it.
//   • `createdAt` is `.optional()` — display-only, so absence never breaks identity.
export const messageItemSchema = z
  .object({
    messageId: z.coerce.string(),
    turnId: z.number(),
    role: z.enum(["user", "assistant"]),
    type: z.number(),
    content: z.string().default(""),
    // Backend serialises empty attachments as JSON `null`, and `.default([])`
    // only substitutes for `undefined` — so coerce `null` → `[]` explicitly.
    attachments: z
      .array(messageAttachmentSchema)
      .nullish()
      .transform((a) => a ?? []),
    createdAt: z.number().optional(),
  })
  .transform((item): Message => {
    // Derived from message identity (id + positional index 0) so re-hydrating the
    // same item yields the same partId (idempotent replay). NOT a random makeId().
    const partId = `${item.messageId}:0`;
    const content: Part[] = [];
    let seedPlan: Plan | undefined;
    if (item.type === MARKDOWN_CONTENT_TYPE) {
      content.push({ partId, type: "text", text: item.content });
    } else if (item.type === PLAN_CONTENT_TYPE) {
      seedPlan = parseInlinePlan(item.content);
      // Only mint a plan Part when the tree actually parsed — an empty/malformed
      // inline payload renders no card and triggers no poll (no fallback).
      if (seedPlan !== undefined) {
        content.push({ partId, type: "plan", planId: seedPlan.planId });
      }
    }

    const message: Message = {
      id: item.messageId,
      // `role` is exactly "user" | "assistant", so the `else` branch is
      // "assistant" → "ai" (exhaustive, not a silent default).
      author: item.role === "user" ? "human" : "ai",
      content,
      turnId: item.turnId,
      createdAt: item.createdAt,
    };
    if (seedPlan !== undefined) {
      message.seedPlan = seedPlan;
    }
    // Omit `attachments` entirely on a plain turn (absent, not []).
    if (item.attachments.length > 0) {
      message.attachments = item.attachments;
    }
    // The experience item (type=8) carries no Part — only a count. `groupTurns`
    // folds it onto the assistant turn.
    if (item.type === EXPERIENCE_CONTENT_TYPE) {
      const experience = parseExperiencePayload(item.content);
      if (experience !== undefined) {
        message.experienceCount = experience.numOperations;
        if (experience.playbookId !== undefined) {
          message.experiencePlaybookId = experience.playbookId;
        }
      }
    }
    return message;
  });
