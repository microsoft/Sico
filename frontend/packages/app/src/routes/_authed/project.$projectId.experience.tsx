import { createFileRoute, Outlet } from "@tanstack/react-router";
import type * as React from "react";

// Pathless-ish layout for the `/experience` segment: a bare <Outlet/> so the
// Experience LIST (`experience.index.tsx`) and an experience DETAIL
// (`experience.$assetId.tsx`) are SIBLINGS under it — the detail page is NOT
// wrapped by the list's tab chrome, it renders full-width on its own.
export const Route = createFileRoute("/_authed/project/$projectId/experience")({
  component: ExperienceOutlet,
});

function ExperienceOutlet(): React.JSX.Element {
  return <Outlet />;
}
