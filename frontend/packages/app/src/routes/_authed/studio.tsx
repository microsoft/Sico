import { createFileRoute, Outlet } from "@tanstack/react-router";
import { type JSX } from "react";

// Thin layout route: declares developer-only access once for every `/studio/*`
// child (the index, `/studio/setup`, and `/studio/$agentId/setup`). Children
// inherit it via `staticData.modes` (ModeGuard's deepest-declared-wins rule), so
// the leaves no longer repeat the gate. Renders a bare <Outlet/> — no extra chrome.
export const Route = createFileRoute("/_authed/studio")({
  staticData: { modes: ["developer"] },
  component: StudioLayout,
});

function StudioLayout(): JSX.Element {
  return <Outlet />;
}
