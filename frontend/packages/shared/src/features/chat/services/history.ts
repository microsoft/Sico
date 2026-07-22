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

import type { AxiosInstance } from "axios";
import { z } from "zod";

import { apiResponseSchema, unwrapData } from "../../../schemas/api";
import { type Message } from "../atoms/chat-atom";
import { messageItemSchema } from "../schemas/message-item";

export type HistoryParams = {
  agentInstanceId: number;
  // Targets a specific conversation (multi-conversation, dwp). Omitted for sico
  // (v1), where the backend returns the agent's single implicit conversation.
  conversationId?: number;
  page?: number;
  pageSize?: number;
  // axios-relative history path, resolved from `SicoConfig.chatEndpoints` by
  // the calling hook (sico's default or dwp's `_v2` variant). Required: the
  // service stays agnostic about which deployment it serves.
  messagesPath: string;
};

// This endpoint carries NO `total` (unlike the generic Paged<T> list
// endpoints), so HistoryPage deliberately omits it — do not reuse Paged<T>.
export type HistoryPage = {
  items: Message[];
  hasNext: boolean;
};

// Backend `data` is `{ messages, hasMore }`; rename to `{ items, hasNext }` so
// callers get a canonical page shape.
const envelope = apiResponseSchema(
  z
    .object({
      messages: z.array(messageItemSchema),
      hasMore: z.boolean(),
    })
    .transform(
      ({ messages, hasMore }): HistoryPage => ({
        items: messages,
        hasNext: hasMore,
      }),
    ),
);

// Backend enforces `pageSize` max=50; clamp client-side so the limit is
// visible at the call site rather than surfacing as a 400.
const MAX_HISTORY_PAGE_SIZE = 50;

const DEFAULT_HISTORY_PAGE_SIZE = 5;

export async function fetchHistory(
  apiClient: AxiosInstance,
  {
    agentInstanceId,
    conversationId,
    page = 1,
    pageSize = DEFAULT_HISTORY_PAGE_SIZE,
    messagesPath,
  }: HistoryParams,
): Promise<HistoryPage> {
  const clampedPageSize = Math.min(pageSize, MAX_HISTORY_PAGE_SIZE);
  const res = await apiClient.get<unknown>(messagesPath, {
    // `conversationId` is included only when set — sico (v1) omits it and gets
    // the single implicit conversation; dwp targets the addressed one.
    params: {
      agentInstanceId,
      page,
      pageSize: clampedPageSize,
      ...(conversationId !== undefined && { conversationId }),
    },
  });
  const parsed = envelope.parse(res.data);
  // Rejects a non-OK code first, then requires `data` — both surface as a
  // ZodError → schema bucket in `classifyError`.
  return unwrapData(parsed, "fetchHistory");
}
