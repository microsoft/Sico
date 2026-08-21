import { Skeleton } from "@sico/ui";
import type * as React from "react";

// The eyebrow section-heading placeholder — a short bar sized like the
// uppercase `SECTION_TITLE_CLASS` labels (Team / Sandbox / Knowledge tags).
// Shared by the three drawer section skeletons. A render helper (not a
// component), so it stays in one file without tripping no-multi-comp.
export function drawerSectionLabel(): React.JSX.Element {
  return <Skeleton className="h-3.5 w-16" />;
}
