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
