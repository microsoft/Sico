import { Spinner } from "@sico/ui";
import { useAtomValue } from "jotai";
import { type ReactElement, useRef, useState, useTransition } from "react";

import { DigitalWorkerCard } from "./digital-worker-card";
import { EmptyState } from "./empty-state";
import { InactiveToggle } from "./inactive-toggle";
import { userAtom } from "../../../atoms/auth-atom";
import { CardGrid } from "../../../components/card-grid";
import { useInfiniteScrollSentinel } from "../../../hooks/use-infinite-scroll-sentinel";
import { useProjectsInfiniteQueryNonSuspense } from "../../projects/hooks/use-projects-query";
import {
  useDedupedAgents,
  useSuspenseAgentsInfiniteQuery,
} from "../hooks/use-agents-query";

type DigitalWorkersGridProps = {
  // Opens the Add DW dialog from the empty state (when the user has a project).
  onAddDw?: () => void;
};

/**
 * Infinite-paginated grid of `/digital-worker`. Errors are not handled
 * here — the suspense hook throws to the `<ErrorBoundary>` mounted in
 * `<DigitalWorkers>`.
 *
 * Own three-part flex column: a scrolling card region (middle) + a fixed
 * inactive-toggle footer, so the toggle stays reachable without scrolling to
 * the end of a long list. The scroll container is local to this component.
 *
 * Inactive DWs are filtered SERVER-SIDE via `showInactive` (it flows into the
 * query key, so hide/show are separately paginated — pagination counts only
 * the visible workers, no "fetched 10, showed 5"). Toggling refetches with the
 * new filter; each filter's pages live in a distinct cache entry, so a second
 * toggle back is instant.
 */
export function DigitalWorkersGrid({
  onAddDw,
}: DigitalWorkersGridProps): ReactElement {
  // "My Digital Workers" = the DWs the current user OPERATES. The backend no
  // longer scopes to the caller, so pass `operatorUsername` explicitly.
  const operatorUsername = useAtomValue(userAtom)?.email;
  const [showInactive, setShowInactive] = useState(false);
  // Toggling the filter changes the suspense query key. Without a transition,
  // the new (uncached) filter would suspend and unmount the whole grid — the
  // toggle button included, destroying focus + flashing the skeleton. A
  // transition keeps the current grid mounted until the new page resolves.
  const [isFilterPending, startFilterTransition] = useTransition();
  const query = useSuspenseAgentsInfiniteQuery({
    operatorUsername,
    showInactive,
  });
  const agents = useDedupedAgents(query.data.pages);
  const { isFetchingNextPage, hasNextPage, fetchNextPage } = query;

  const toggleInactive = (): void => {
    startFilterTransition(() => setShowInactive((prev) => !prev));
  };

  // Non-suspense read: the empty-state CTA branches on whether the user has any
  // project. `projectsQuery.isPending` gates the CTA so we don't flash "Create
  // project" for a user who actually has one (or vice versa) before it resolves.
  const projectsQuery = useProjectsInfiniteQueryNonSuspense({});
  const hasProject =
    (projectsQuery.data?.pages.flatMap((page) => page.items).length ?? 0) > 0;

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="scrollbar min-h-0 flex-1 overflow-y-auto px-16 pb-8"
      >
        {agents.length === 0 ? (
          // Empty in EITHER filter → the onboarding CTA (add DW / create
          // project). Rendered inline (not an early return) so the reveal
          // toggle below stays mounted: a user whose only workers are inactive
          // sees the CTA AND can still reveal them. `EmptyState` self-centers
          // (MessageState `fill`), so it fills the scroll region.
          <EmptyState
            hasProject={hasProject}
            projectsLoading={projectsQuery.isPending}
            onAddDw={onAddDw}
          />
        ) : (
          <CardGrid>
            {agents.map((agent) => (
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
      <InactiveToggle
        showInactive={showInactive}
        isPending={isFilterPending}
        onToggle={toggleInactive}
      />
    </div>
  );
}
