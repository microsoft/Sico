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
