import { createFileRoute, Outlet } from "@tanstack/react-router";
import type * as React from "react";

// Pathless-ish layout for the `/knowledge` segment: a bare <Outlet/> so the
// Knowledge LIST (`knowledge.index.tsx`) and a knowledge DETAIL
// (`knowledge.$assetId.tsx`) are SIBLINGS under it — the detail page is NOT
// wrapped by the list's tab chrome, it renders full-width on its own.
export const Route = createFileRoute("/_authed/project/$projectId/knowledge")({
  component: KnowledgeOutlet,
});

function KnowledgeOutlet(): React.JSX.Element {
  return <Outlet />;
}
