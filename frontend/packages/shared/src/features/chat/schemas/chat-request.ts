import { z } from "zod";

// One ready attachment ref in the send payload (backend `common.proto`
// Attachment), referenced by uri + sasUrl. The upload's `id` is dropped —
// legacy never sends it and the backend resolves the asset by uri, so it
// carried no meaning on the wire.
export const chatAttachmentRefSchema = z.object({
  name: z.string(),
  size: z.number(),
  type: z.string(),
  uri: z.string(),
  sasUrl: z.string().optional(),
});
export type ChatAttachmentRef = z.infer<typeof chatAttachmentRefSchema>;

// Outbound send payload (backend `ChatV2Request`, dto/conversation/chat.go:
// `message` string + `agentInstanceId` int64, both binding:"required",
// `attachments []*Attachment`). `conversationId` targets a specific
// conversation (multi-conversation): the DW home mints one via
// `POST /conversation` and sends into it. OMITTED for sico (v1) — there the
// backend still derives the single conversation from (username, agentId,
// agentInstanceId) via ensureConversation (§7).
export const chatRequestSchema = z.object({
  agentInstanceId: z.number(),
  message: z.string(),
  attachments: z.array(chatAttachmentRefSchema),
  conversationId: z.number().optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
