import { createFileRoute, Outlet } from "@tanstack/react-router";
import { type JSX } from "react";

// Layout segment for `/digital-worker/$agentId/collaboration`. The chat lives at
// the `$conversationId` child (multi-conversation); this segment only renders an
// <Outlet>. A bare `/collaboration` (no conversation) is handled by the sibling
// index route, which redirects to the DW home. History prefetch moved to the
// child route, which knows the target conversation id.
export const Route = createFileRoute(
  "/_authed/digital-worker/$agentId/collaboration",
)({
  component: DwAgentCollaborationLayout,
});

function DwAgentCollaborationLayout(): JSX.Element {
  return <Outlet />;
}
