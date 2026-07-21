import { useAtomValue } from "jotai";
import { type JSX } from "react";

import { MessageHistorySkeleton } from "./message/message-history-skeleton";
import { MessageList } from "./message-list";
import { activeHistoryEmptyAtom } from "../atoms/chat-atom";
import { useHistory } from "../hooks/use-history";

type Props = {
  agentInstanceId: number;
  // dwp multi-conversation target; undefined for sico (v1). Threaded into
  // `useHistory` so the fetch + cache key address the right conversation.
  conversationId?: number;
};

/**
 * Fetches + hydrates history (`useHistory`, NON-suspense — never throws) and
 * renders the scrolling message list. `MessageList` reads the store, so it
 * ALWAYS renders once there's anything to show — a history-fetch failure is a
 * toast + log inside `useHistory`, never a panel-replacing error, so the user's
 * just-sent (optimistic) message stays visible. The skeleton shows ONLY on a
 * genuinely-empty first load (pending AND no messages yet); a home-first-send
 * already has an optimistic message in the store, so it skips straight to the
 * list. Gate lives here, not in `MessageList` (which is already at the
 * function-length cap).
 */
export function MessageHistory({
  agentInstanceId,
  conversationId,
}: Props): JSX.Element {
  const { isPending, hasMore, fetchOlder, isFetchingOlder } = useHistory(
    agentInstanceId,
    conversationId,
  );
  const isEmpty = useAtomValue(activeHistoryEmptyAtom);

  if (isPending && isEmpty) {
    return <MessageHistorySkeleton />;
  }

  return (
    <MessageList
      hasMore={hasMore}
      fetchOlder={fetchOlder}
      isFetchingOlder={isFetchingOlder}
    />
  );
}
