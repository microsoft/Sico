import { Spinner } from "@sico/ui";
import type * as React from "react";
import { type RefObject, useRef } from "react";

import { EmptyState } from "./empty-state";
import { ProjectCard } from "./project-card";
import { CardGrid } from "../../../components/card-grid";
import { useInfiniteScrollSentinel } from "../../../hooks/use-infinite-scroll-sentinel";
import { useProjectsInfiniteQuery } from "../hooks/use-projects-query";

type ProjectsGridProps = {
  // Local-scroll container the grid lives in; forwarded to the infinite
  // scroll sentinel so it observes against that container, not the page.
  rootRef?: RefObject<HTMLElement | null>;
};

/**
 * Infinite-paginated grid of `/project`. Errors are not handled here —
 * the suspense hook throws to the `<ErrorBoundary>` mounted in `<Projects>`.
 */
export function ProjectsGrid({
  rootRef,
}: ProjectsGridProps): React.JSX.Element {
  const { data, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useProjectsInfiniteQuery();

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useInfiniteScrollSentinel(
    sentinelRef,
    {
      hasNextPage,
      isFetchingNextPage,
      fetchNextPage,
    },
    { rootRef },
  );

  const items = data.pages.flatMap((page) => page.items);

  if (items.length === 0) {
    // EmptyState fills + centers itself (MessageState `fill`), so no wrapper.
    return <EmptyState />;
  }

  return (
    <div>
      <CardGrid>
        {items.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </CardGrid>
      <div ref={sentinelRef} aria-hidden="true" />
      {isFetchingNextPage ? (
        <div className="flex w-full items-center justify-center py-6">
          <Spinner aria-label="Loading more" />
        </div>
      ) : null}
    </div>
  );
}
