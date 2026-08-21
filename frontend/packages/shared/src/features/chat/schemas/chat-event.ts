import { z } from "zod";

// Backend `MessageContentType`; C1 renders only text (type 1). Parsed as a plain
// number — not a strict enum — so an unknown future type never drops the frame.
// `6 ERROR` never arrives here: server errors are a separate `event:error` frame.
export const MARKDOWN_CONTENT_TYPE = 1;

// The PLAN frame carries a numeric `turnId`; consumers mint `planId = String(turnId)`.
export const PLAN_CONTENT_TYPE = 9;

// ACE "experience" item; `content` is a JSON blob `{numOperations, playbookId}`,
// surfaced as the turn's experience count.
export const EXPERIENCE_CONTENT_TYPE = 8;

// Types that may legitimately arrive as a `message` frame (0 UNKNOWN, 1 MARKDOWN,
// 4 IMAGE, 5 END, 8 PLAYBOOK_INGESTION, 9 PLAN) → domain skips an unrendered one
// at `debug`; a type outside this set → `warn`. `6 ERROR` is deliberately
// excluded: server errors arrive as a separate `event:error` frame, so a
// `type: 6` message frame is a contract violation that should `warn`, not vanish.
export const KNOWN_CONTENT_TYPES: ReadonlySet<number> = new Set([
  0, 1, 4, 5, 8, 9,
]);

// The `message` frame's `data`. Only `content` + `type` are consumed in C1; the
// rest are wire-present but reserved. `content` is omitted on non-text frames (Go
// `omitempty`) → `.default("")` so the consumer's `buffer += content` stays `string`.
export const chatStreamResponseSchema = z.object({
  type: z.number(),
  content: z.string().default(""),
  timestamp: z.number().optional(),
  isFinal: z.boolean().optional(),
  role: z.string().optional(),
  conversationId: z.number().optional(),
  turnId: z.number().optional(),
});

export const chatDoneSchema = z.object({ timestamp: z.number().optional() });

// A validated SSE frame. `keepalive` is filtered BEFORE this runs.
export const chatEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("message"), data: chatStreamResponseSchema }),
  z.object({ event: z.literal("done"), data: chatDoneSchema }),
  z.object({ event: z.literal("error"), data: z.string() }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;
