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
import { refreshActivityListsAfterSettle } from "../utils/refresh-activity-lists";

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

// The create-first page-1 skip is only needed until THIS turn settles: once
// persisted, page 1 holds real history, not a turnId-less twin. Drop the marker
// so a later cold revisit + in-flight send never skips that real page 1 (bounds
// the skip to the first-send window). No-op for a plain send (no id yet).
function clearCreateFirstMarker(
  store: ReturnType<typeof useStore>,
  conversationId?: number,
): void {
  if (conversationId === undefined) {
    return;
  }
  store.set(createFirstConversationIdsAtom, (prev) => {
    if (!prev.has(conversationId)) {
      return prev;
    }
    const next = new Set(prev);
    next.delete(conversationId);
    return next;
  });
}

// On turn settle: refresh the history cache (so a revisit refetches instead of
// the empty seed), surface the conversation + its DW in the activity-sorted
// lists, and drop the create-first skip marker.
function onSendSettle(
  store: ReturnType<typeof useStore>,
  queryClient: ReturnType<typeof useQueryClient>,
  agentInstanceId: number,
  conversationId?: number,
): void {
  invalidateHistory(queryClient, agentInstanceId, conversationId);
  refreshActivityListsAfterSettle(queryClient, agentInstanceId, conversationId);
  clearCreateFirstMarker(store, conversationId);
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
        // On turn settle the message is persisted server-side; refresh the
        // history cache + activity lists so a revisit refetches, not the seed.
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
