import { z } from "zod";

// One conversation under a Digital Worker (backend `ConversationData`). Only the
// fields the sidebar list + create flow read are modeled: `id` is the identity
// and routing key (required — a conversation with no id can't be addressed) and
// `title` defaults to "" for a fresh/untitled conversation. `createdAt` and
// `agentInstanceId` (flattened from the backend's nested
// `agentInstanceInfo.instanceId`) are carried through but not yet read by any
// consumer — the list renders in server order (backend sorts by recency) and
// doesn't client-side sort or filter. Kept modeled so the shape matches the wire
// and a future ordering/ownership check needs no schema change. Lenient by
// design — unmodeled fields (status, metaData, creatorUsername, lastSectionId)
// are ignored so a stray/extra field never rejects the whole list and blanks the
// sidebar (mirrors message-item.ts).
export const conversationSummarySchema = z
  .object({
    id: z.number(),
    title: z.string().default(""),
    createdAt: z.number().optional(),
    agentInstanceInfo: z.object({ instanceId: z.number() }).nullish(),
  })
  .transform((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    // Optional chaining collapses both null and undefined from `.nullish()`.
    agentInstanceId: c.agentInstanceInfo?.instanceId,
  }));
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

// Backend `data` for GET /conversation/list — the page array + a paging flag.
export const conversationListSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  hasMore: z.boolean(),
});

// Backend `data` for GET /conversation?id= — the single record is nested under a
// `conversation` key (unlike POST /conversation, whose `data` IS the summary).
// The inner object carries extra fields (status, metaData, creatorUsername,
// lastSectionId) that `conversationSummarySchema` leniently ignores.
export const conversationDetailSchema = z.object({
  conversation: conversationSummarySchema,
});

// Outbound create payload (backend `CreateConversationRequest`): the DW instance
// is required; `title` is optional (the backend names an untitled conversation).
// Modeled as a schema for parity with `chatRequestSchema` — the outbound shape
// lives next to its inbound siblings.
export const createConversationRequestSchema = z.object({
  agentInstanceId: z.number(),
  title: z.string().optional(),
});
export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;
