import type * as React from "react";

import { ProjectCardSkeleton } from "./project-card-skeleton";
import { CardGrid } from "../../../components/card-grid";

const SKELETON_COUNT = 12;

/** Suspense fallback for `<ProjectsGrid>` — mirrors the grid layout so the page does not reflow when data arrives. */
export function ProjectsGridSkeleton(): React.JSX.Element {
  return (
    <CardGrid role="status" aria-label="Loading projects">
      {Array.from({ length: SKELETON_COUNT }, (_, idx) => (
        <ProjectCardSkeleton key={idx} />
      ))}
    </CardGrid>
  );
}
