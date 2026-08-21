import { createFileRoute, redirect } from "@tanstack/react-router";

// A bare `/digital-worker/$agentId/collaboration` (no conversation) has nothing
// to render: chat is addressed by `$conversationId`. Redirect to the DW home
// (the index), which is the launch pad for starting a new conversation.
export const Route = createFileRoute(
  "/_authed/digital-worker/$agentId/collaboration/",
)({
  beforeLoad: ({ params }) => {
    // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `redirect()` is the documented control-flow signal
    throw redirect({
      to: "/digital-worker/$agentId",
      params: { agentId: params.agentId },
      replace: true,
    });
  },
});
