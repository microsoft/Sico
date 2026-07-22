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
