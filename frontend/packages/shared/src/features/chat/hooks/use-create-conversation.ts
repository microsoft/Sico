// Mints a fresh conversation under a Digital Worker. `create-first`: the home
// page awaits this on send to get the server id, then parks the message and
// navigates to `/collaboration/$conversationId`. On success the DW's conversation
// list is invalidated so the sidebar shows the new row, and the new id is marked
// title-pending so the sidebar polls for its async-generated title.
import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";
import { useSetAtom } from "jotai";

import { useApiClient } from "../../../services/api-client-context";
import {
  createFirstConversationIdsAtom,
  pendingTitleConversationIdsAtom,
} from "../atoms/chat-atom";
import {
  type ConversationSummary,
  type CreateConversationRequest,
} from "../schemas/conversation";
import { createConversation } from "../services/conversation";

export function useCreateConversation(): UseMutationResult<
  ConversationSummary,
  Error,
  CreateConversationRequest
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const setPendingTitleIds = useSetAtom(pendingTitleConversationIdsAtom);
  const setCreateFirstIds = useSetAtom(createFirstConversationIdsAtom);
  return useMutation({
    mutationFn: (
      vars: CreateConversationRequest,
    ): Promise<ConversationSummary> => createConversation(apiClient, vars),
    onSuccess: (conversation) => {
      // Refresh the sidebar list for this (and every) DW. Broad key so the new
      // row appears without threading the agent id into the invalidation.
      void queryClient.invalidateQueries({
        queryKey: ["conversations", "list"],
      });
      // Mark this fresh id as title-pending — the sole trigger for the sidebar's
      // title poll. Scoped to ids we KNOW were just created, so a historical
      // "New Session" row is never polled.
      setPendingTitleIds((prev) => new Set(prev).add(conversation.id));
      // Mark it create-first so `useHydrateHistory` skips page 1 (the just-sent
      // twin) only for THIS conversation while its send is in flight — never for
      // an existing conversation whose page 1 holds real history.
      setCreateFirstIds((prev) => new Set(prev).add(conversation.id));
    },
  });
}
