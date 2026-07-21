import { Spinner } from "@sico/ui";
import { type ReactElement, useRef, useState } from "react";

import { DigitalWorkerCard } from "./digital-worker-card";
import { EmptyState } from "./empty-state";
import { InactiveToggle } from "./inactive-toggle";
import { CardGrid } from "../../../components/card-grid";
import { useInfiniteScrollSentinel } from "../../../hooks/use-infinite-scroll-sentinel";
import {
  useDedupedAgents,
  useSuspenseAgentsInfiniteQuery,
} from "../hooks/use-agents-query";
import { useVisibleAgents } from "../hooks/use-visible-agents";

/**
 * Infinite-paginated grid of `/digital-worker`. Errors are not handled
 * here — the suspense hook throws to the `<ErrorBoundary>` mounted in
 * `<DigitalWorkers>`.
 *
 * Own three-part flex column: a scrolling card region (middle) + a fixed
 * inactive-toggle footer, so the toggle stays reachable without scrolling to
 * the end of a long list. The scroll container is local to this component.
 */
export function DigitalWorkersGrid(): ReactElement {
  const query = useSuspenseAgentsInfiniteQuery();
  const agents = useDedupedAgents(query.data.pages);
  const { isFetchingNextPage, hasNextPage, fetchNextPage } = query;

  const [showInactive, setShowInactive] = useState(false);
  const { visible, inactiveCount } = useVisibleAgents(agents, showInactive);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useInfiniteScrollSentinel(
    sentinelRef,
    {
      hasNextPage,
      isFetchingNextPage,
      fetchNextPage,
    },
    { rootRef: scrollRef },
  );

  if (agents.length === 0) {
    // EmptyState fills + centers itself (MessageState `fill`), so no wrapper.
    return <EmptyState />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="scrollbar min-h-0 flex-1 overflow-y-auto px-16 pb-8"
      >
        {visible.length === 0 ? (
          // Every loaded DW is inactive and hidden — the CardGrid would be
          // blank, so guide the user to the reveal toggle below instead.
          <p className="text-foreground-tertiary py-16 text-center text-sm">
            All digital workers are inactive. Use the toggle below to show them.
          </p>
        ) : (
          <CardGrid>
            {visible.map((agent) => (
              <DigitalWorkerCard key={agent.id} agent={agent} />
            ))}
          </CardGrid>
        )}
        <div ref={sentinelRef} aria-hidden="true" />
        {isFetchingNextPage ? (
          <div className="flex w-full items-center justify-center py-6">
            <Spinner aria-label="Loading more" />
          </div>
        ) : null}
      </div>
      {inactiveCount > 0 ? (
        <InactiveToggle
          count={inactiveCount}
          showInactive={showInactive}
          onToggle={() => setShowInactive((prev) => !prev)}
        />
      ) : null}
    </div>
  );
}
