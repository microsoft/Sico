import { createFileRoute, Outlet } from "@tanstack/react-router";
import { type JSX } from "react";

// Thin layout route: declares operator-only access once for every `/project/*`
// child. Children (the index and the `$projectId` subtree) inherit it via
// `staticData.modes` (ModeGuard's deepest-declared-wins rule), so the leaves no
// longer repeat the gate. Renders a bare <Outlet/> — no extra chrome.
export const Route = createFileRoute("/_authed/project")({
  staticData: { modes: ["operator"] },
  component: ProjectLayout,
});

function ProjectLayout(): JSX.Element {
  return <Outlet />;
}
