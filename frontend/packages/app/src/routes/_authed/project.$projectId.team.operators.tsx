import {
  MembersPage,
  projectMembersQueryOptions,
} from "@sico/shared/features/team/index.ts";
import { createFileRoute, notFound } from "@tanstack/react-router";
import type * as React from "react";
import { z } from "zod";

const paramsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});

// The Operators (people) team tab (`/project/$id/team/operators`). Sibling of
// the digital-workers tab under the `team` Outlet — each tab is its own URL.
export const Route = createFileRoute(
  "/_authed/project/$projectId/team/operators",
)({
  beforeLoad: ({ params }) => {
    if (!paramsSchema.safeParse(params).success) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `notFound()` is the documented control-flow signal
      throw notFound();
    }
  },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      projectMembersQueryOptions(Number(params.projectId), context.apiClient),
    );
  },
  component: MembersOperatorsPage,
});

function MembersOperatorsPage(): React.JSX.Element {
  const { projectId } = Route.useParams();
  return <MembersPage projectId={Number(projectId)} activeTab="humans" />;
}
