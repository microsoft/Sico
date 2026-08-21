import { type InfiniteData, type QueryClient } from "@tanstack/react-query";

import { type Paged } from "../../../schemas/paginated";
import { AGENTS_QUERY_KEY_PREFIX } from "../hooks/use-agents-query";
import { type Agent } from "../schemas/agent";

// Re-order the activity-sorted DW list after a turn settles, so the just-used
// DW surfaces first. Unlike a blanket invalidate, this skips the refetch when
// the DW is ALREADY at the head of every cached list page — a long
// back-and-forth in one DW then costs no extra fetch. The sidebar DW preview
// (`useDwPreview`) IS mounted during chat, so a blanket invalidate would refetch
// it on every message; the head-check avoids that once the DW has surfaced.
//
// Checks every cached `["agents","list", …]` entry (hide/show, any pageSize):
// if some mounted list already shows this DW first, nothing to do. Otherwise the
// order may have changed, so invalidate the whole prefix and let react-query
// refetch the active observers.
export function bumpAgentToTop(
  queryClient: QueryClient,
  agentInstanceId: number,
): void {
  const entries = queryClient.getQueriesData<InfiniteData<Paged<Agent>>>({
    queryKey: AGENTS_QUERY_KEY_PREFIX,
  });
  const alreadyTop = entries.some(
    ([, data]) => data?.pages[0]?.items[0]?.id === agentInstanceId,
  );
  if (alreadyTop) {
    return;
  }
  void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY_PREFIX });
}
