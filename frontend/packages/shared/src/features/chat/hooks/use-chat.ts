import { toast } from "@sico/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useCallback } from "react";

import { invalidateHistory } from "./use-history";
import { CHAT_STREAM_ENDPOINTS } from "../../../constants/endpoints";
import { useOrganizationIdGetter } from "../../../hooks/use-organization-id-getter";
import { type CommonAttachment } from "../../../schemas/common-attachment";
import { useApiClient } from "../../../services/api-client-context";
import { uploadAttachment } from "../../../services/upload-attachment";
import { createFirstConversationIdsAtom } from "../atoms/chat-atom";
import { sendMessage, stopTurn } from "../services/chat";
import { openChatStream } from "../services/chat-stream";
import { cancelPlan } from "../services/plan";
import { refreshConversationStatus } from "../utils/refresh-conversation-status";

export type UseChat = {
  send: (
    text: string,
    attachments: CommonAttachment[],
    conversationId?: number,
  ) => Promise<void>;
  // `reconnectStop` is the reconnect manager's hard idle exit; Stop must route
  // through it on every path, so it's passed in rather than re-derived.
  stop: (reconnectStop: () => void) => Promise<void>;
  upload: (file: File, signal: AbortSignal) => Promise<CommonAttachment>;
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

// The first terminal signal ends the create-first window and stales only this
// conversation's history. Inactive entries refetch on their next mount.
function onSendTerminal(
  store: ReturnType<typeof useStore>,
  queryClient: ReturnType<typeof useQueryClient>,
  agentInstanceId: number,
  conversationId?: number,
): void {
  invalidateHistory(queryClient, agentInstanceId, conversationId);
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
  const getOrganizationId = useOrganizationIdGetter();

  const send = useCallback(
    (text: string, attachments: CommonAttachment[], conversationId?: number) =>
      sendMessage(store, text, attachments, {
        agentInstanceId,
        conversationId,
        openChatStream: (payload, options) =>
          openChatStream(payload, {
            ...options,
            url: CHAT_STREAM_ENDPOINTS.chat,
            getOrganizationId,
          }),
        toastError: (message) => toast.error(message),
        onOpen: () => refreshConversationStatus(queryClient, agentInstanceId),
        onTerminal: () =>
          onSendTerminal(store, queryClient, agentInstanceId, conversationId),
        onSettle: () => refreshConversationStatus(queryClient, agentInstanceId),
      }),
    [store, agentInstanceId, queryClient, getOrganizationId],
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
