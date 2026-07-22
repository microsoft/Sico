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

import { toast } from "@sico/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useCallback } from "react";

import { invalidateHistory } from "./use-history";
import { useApiClient } from "../../../services/api-client-context";
import { useSicoConfig } from "../../../services/sico-config-context";
import { createFirstConversationIdsAtom } from "../atoms/chat-atom";
import { type ChatAttachmentRef } from "../schemas/chat-request";
import { sendMessage, stopTurn } from "../services/chat";
import { resolveChatEndpoints } from "../services/chat-endpoints";
import {
  openChatStream,
  type OpenChatStreamOptions,
} from "../services/chat-stream";
import { cancelPlan } from "../services/plan";
import { uploadAttachment } from "../services/upload";

export type UseChat = {
  send: (
    text: string,
    attachments: ChatAttachmentRef[],
    conversationId?: number,
  ) => Promise<void>;
  // `reconnectStop` is the reconnect manager's hard idle exit; Stop must route
  // through it on every path, so it's passed in rather than re-derived.
  stop: (reconnectStop: () => void) => Promise<void>;
  upload: (file: File, signal: AbortSignal) => Promise<ChatAttachmentRef>;
};

// On turn settle the message is persisted server-side: refresh the history
// cache so a revisit refetches it instead of the empty seed, and drop the
// create-first page-1 skip marker (once persisted, page 1 holds real history,
// not a turnId-less twin — bounds the skip to the first-send window).
function onSendSettle(
  store: ReturnType<typeof useStore>,
  queryClient: ReturnType<typeof useQueryClient>,
  agentInstanceId: number,
  conversationId?: number,
): void {
  invalidateHistory(queryClient, agentInstanceId, conversationId);
  if (conversationId !== undefined) {
    store.set(createFirstConversationIdsAtom, (prev) => {
      if (!prev.has(conversationId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });
  }
}

// The only React-aware layer: binds the live store + axios into the plain
// domain fns. Components consume `send`/`stop`/`upload`, never the store or
// transport directly.
export function useChat(
  agentInstanceId: number,
  // The active view's conversation id — used to address `cancelPlan`. Distinct
  // from `send`'s per-call `conversationId` (the target of a specific message,
  // which may be a not-yet-created conversation).
  viewConversationId?: number,
): UseChat {
  const store = useStore();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { chatEndpoints } = useSicoConfig();
  // The stream URL is config-derived; bake it into the injected transport so
  // the domain `sendMessage` stays backend-agnostic.
  const { chatStreamUrl } = resolveChatEndpoints(chatEndpoints);

  const send = useCallback(
    (text: string, attachments: ChatAttachmentRef[], conversationId?: number) =>
      sendMessage(store, text, attachments, {
        agentInstanceId,
        conversationId,
        openChatStream: (
          payload,
          options: Omit<OpenChatStreamOptions, "url">,
        ) => openChatStream(payload, { ...options, url: chatStreamUrl }),
        toastError: (message) => toast.error(message),
        onSettle: () =>
          onSendSettle(store, queryClient, agentInstanceId, conversationId),
      }),
    [store, agentInstanceId, chatStreamUrl, queryClient],
  );

  const stop = useCallback(
    (reconnectStop: () => void) =>
      stopTurn(store, {
        cancelPlan: (turnId) =>
          cancelPlan(apiClient, {
            agentInstanceId,
            turnId,
            conversationId: viewConversationId ?? 0,
          }),
        reconnectStop,
        toastError: (message) => toast.error(message),
      }),
    [store, apiClient, agentInstanceId, viewConversationId],
  );

  const upload = useCallback(
    (file: File, signal: AbortSignal) =>
      uploadAttachment(apiClient, file, signal),
    [apiClient],
  );

  return { send, stop, upload };
}
