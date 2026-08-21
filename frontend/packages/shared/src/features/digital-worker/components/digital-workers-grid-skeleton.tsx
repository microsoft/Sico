import type { ReactElement } from "react";

import { DigitalWorkerCardSkeleton } from "./digital-worker-card-skeleton";
import { CardGrid } from "../../../components/card-grid";

const SKELETON_COUNT = 12;

/** Suspense fallback for `<DigitalWorkersGrid>` — mirrors the grid layout so the page does not reflow when data arrives. */
export function DigitalWorkersGridSkeleton(): ReactElement {
  return (
    <CardGrid role="status" aria-label="Loading digital workers">
      {Array.from({ length: SKELETON_COUNT }, (_, idx) => (
        // eslint-disable-next-line react/no-array-index-key -- static placeholder count
        <DigitalWorkerCardSkeleton key={idx} />
      ))}
    </CardGrid>
  );
}
