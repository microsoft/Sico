import { DigitalWorkerHome } from "@sico/shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type JSX } from "react";

// `/digital-worker/$agentId` index — ALWAYS the DW home page (hero + composer +
// suggested tasks). DigitalWorkerHome owns its own agent-query Suspense
// boundary, so this route is a thin mount. Sending parks the message and calls
// `onSubmitted`, which navigates to /collaboration where the chat drains + sends
// it. DW nav links target /collaboration directly, so only the explicit index
// URL lands here. No loader: SuggestedTasks fetches its recommendations on mount
// behind its own local Suspense boundary.
export const Route = createFileRoute("/_authed/digital-worker/$agentId/")({
  component: DwAgentHome,
});

function DwAgentHome(): JSX.Element {
  const { agentId } = Route.useParams();
  const agentInstanceId = Number(agentId);
  const navigate = useNavigate();
  return (
    <DigitalWorkerHome
      agentInstanceId={agentInstanceId}
      onSubmitted={(conversationId) => {
        void navigate({
          to: "/digital-worker/$agentId/collaboration/$conversationId",
          params: {
            agentId: String(agentInstanceId),
            conversationId: String(conversationId),
          },
          // replace: the home is a launch pad — after sending, Back should not
          // return here and re-show the empty composer.
          replace: true,
        });
      }}
    />
  );
}
