import { createFileRoute, Outlet } from "@tanstack/react-router";
import type * as React from "react";

// Layout for the `/team` segment: a bare <Outlet/> so the two tab pages
// (`team.operators.tsx`, `team.digital-workers.tsx`) and the index redirect
// are siblings under it — each tab is its own URL, mirroring the knowledge
// Outlet. The shared MembersPage chrome (breadcrumb + tabs + Invite) lives in
// each leaf via the `MembersPage` component.
export const Route = createFileRoute("/_authed/project/$projectId/team")({
  component: TeamOutlet,
});

function TeamOutlet(): React.JSX.Element {
  return <Outlet />;
}
