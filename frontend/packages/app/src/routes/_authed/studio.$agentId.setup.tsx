import {
  rolesQueryOptions,
  SETUP_SKILLS_PAGE_SIZE,
  skillsInfiniteQueryOptions,
} from "@sico/shared/features/skill/index.ts";
import {
  AgentSetupPage,
  singleAgentQueryOptions,
} from "@sico/shared/features/studio/index.ts";
import { createFileRoute } from "@tanstack/react-router";
import type { JSX } from "react";

// Edit-mode setup for an existing studio Digital Worker. The page body lives in
// @sico/shared (AgentSetupPage); this route owns the agent/skills/roles prefetch
// so the body's suspense queries hit cache.
export const Route = createFileRoute("/_authed/studio/$agentId/setup")({
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      singleAgentQueryOptions(context.apiClient, params.agentId),
    );
    void context.queryClient.prefetchInfiniteQuery(
      skillsInfiniteQueryOptions(context.apiClient, {
        agentId: params.agentId,
        pageSize: SETUP_SKILLS_PAGE_SIZE,
      }),
    );
    void context.queryClient.prefetchQuery(
      rolesQueryOptions(context.apiClient),
    );
  },
  head: () => ({ meta: [{ title: "Setup · SICO" }] }),
  component: RouteComponent,
});

function RouteComponent(): JSX.Element {
  const { agentId } = Route.useParams();
  return <AgentSetupPage agentId={agentId} />;
}
