import { createFileRoute, Outlet } from "@tanstack/react-router";
import type * as React from "react";

// Pathless-ish layout for the `/deliverable` segment: a bare <Outlet/> so the
// Deliverable LIST (`deliverable.index.tsx`) and a deliverable DETAIL
// (`deliverable.$assetId.tsx`) are SIBLINGS under it — the detail page is NOT
// wrapped by the list's tab chrome, it renders full-width on its own.
export const Route = createFileRoute("/_authed/project/$projectId/deliverable")(
  {
    component: DeliverableOutlet,
  },
);

function DeliverableOutlet(): React.JSX.Element {
  return <Outlet />;
}
