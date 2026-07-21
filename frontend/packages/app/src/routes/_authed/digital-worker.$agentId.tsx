import { DeviceButton } from "@sico/shared";
import { conversationListQueryOptions } from "@sico/shared/features/chat/index.ts";
import {
  AgentDetailLayout,
  agentQueryOptions,
} from "@sico/shared/features/digital-worker/index.ts";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { type JSX } from "react";

// Layout shell for a single Digital Worker. The loader prefetches agent detail
// (Header suspense query) and the sidebar's conversation list (fire-and-forget)
// so both hit cache on mount — the list renders without a skeleton flash, like
// the agent detail. The layout + error boundary live in the shared feature;
// this route only owns the router primitives (params + Outlet) and wires the
// chat Device button into the Header's actions slot.
export const Route = createFileRoute("/_authed/digital-worker/$agentId")({
  loader: ({ context, params }) => {
    const agentId = Number(params.agentId);
    if (Number.isFinite(agentId)) {
      void context.queryClient.prefetchQuery(
        agentQueryOptions(agentId, context.apiClient),
      );
      void context.queryClient.prefetchInfiniteQuery(
        conversationListQueryOptions(agentId, context.apiClient),
      );
    }
  },
  head: () => ({ meta: [{ title: "Digital Worker · SICO" }] }),
  component: DwAgentRoute,
});

function DwAgentRoute(): JSX.Element {
  const { agentId } = Route.useParams();
  return (
    <AgentDetailLayout
      agentId={agentId}
      actions={<DeviceButton agentInstanceId={Number(agentId)} />}
    >
      <Outlet />
    </AgentDetailLayout>
  );
}
