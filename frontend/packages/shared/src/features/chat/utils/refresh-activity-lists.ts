import { type InfiniteData, type QueryClient } from "@tanstack/react-query";

import { bumpAgentToTop } from "../../digital-worker/utils/bump-agent-to-top";
import { conversationListQueryKey } from "../hooks/use-conversations";
import { type ConversationListPage } from "../services/conversation";

// Re-order the activity-sorted lists after a turn settles. Two lists key off
// conversation activity: this DW's conversation list and the DW list itself.
//
// Conversation list: refetch only when the just-used conversation isn't already
// at the top. It's sorted by activity (`orderBy=Activity`), so a fresh turn only
// changes order when this conversation wasn't the most-recently-active one —
// every subsequent turn in the SAME conversation leaves it at the head, so we
// skip the refetch. Reading the first item off the cache (rather than always
// invalidating) is what keeps a long back-and-forth from refetching on every
// message. `conversationId` is undefined on the create-first flow's first send —
// already handled by `useCreateConversation`'s invalidate, so that part bails.
//
// DW list: same head-check via `bumpAgentToTop`. The sidebar DW preview
// (`useDwPreview`) IS mounted during chat, so a blanket invalidate would refetch
// it on every message — the head-check skips the refetch once the DW is already
// first.
export function refreshActivityListsAfterSettle(
  queryClient: QueryClient,
  agentInstanceId: number,
  conversationId?: number,
): void {
  bumpConversationToTop(queryClient, agentInstanceId, conversationId);
  bumpAgentToTop(queryClient, agentInstanceId);
}

function bumpConversationToTop(
  queryClient: QueryClient,
  agentInstanceId: number,
  conversationId?: number,
): void {
  if (conversationId === undefined) {
    return;
  }
  const key = conversationListQueryKey(agentInstanceId);
  const cached =
    queryClient.getQueryData<InfiniteData<ConversationListPage>>(key);
  const top = cached?.pages[0]?.items[0]?.id;
  if (top === conversationId) {
    return; // already most-recent — no reorder, no refetch.
  }
  void queryClient.invalidateQueries({ queryKey: key });
}
