import { agentsQueryOptions } from "@sico/shared/features/digital-worker/index.ts";
import { MembersPage } from "@sico/shared/features/team/index.ts";
import { createFileRoute, notFound } from "@tanstack/react-router";
import type * as React from "react";
import { z } from "zod";

const paramsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});

// The Digital workers team tab (`/project/$id/team/digital-workers`). Sibling
// of the operators tab under the `team` Outlet. The tab pages the
// project-scoped agents query; prefetch its first page so the list resolves
// with the route instead of a post-mount client fetch (mirrors the operators
// tab's members prefetch).
export const Route = createFileRoute(
  "/_authed/project/$projectId/team/digital-workers",
)({
  beforeLoad: ({ params }) => {
    if (!paramsSchema.safeParse(params).success) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `notFound()` is the documented control-flow signal
      throw notFound();
    }
  },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchInfiniteQuery(
      agentsQueryOptions(
        { projectId: Number(params.projectId) },
        context.apiClient,
      ),
    );
  },
  component: MembersDigitalWorkersPage,
});

function MembersDigitalWorkersPage(): React.JSX.Element {
  const { projectId } = Route.useParams();
  return <MembersPage projectId={Number(projectId)} activeTab="workers" />;
}
