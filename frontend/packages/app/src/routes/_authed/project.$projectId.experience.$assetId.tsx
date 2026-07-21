import {
  AssetDetailPage,
  assetDetailQueryOptions,
  projectDetailQueryOptions,
} from "@sico/shared/features/projects/index.ts";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { type JSX } from "react";
import { z } from "zod";

// Experience detail nests under its project (mirrors knowledge/deliverable), so
// the route carries `$projectId` for back-nav. Loader prefetches fire-and-forget
// to keep the skeleton up; `:projectId` is guarded by the layout parent.
export const Route = createFileRoute(
  "/_authed/project/$projectId/experience/$assetId",
)({
  beforeLoad: ({ params }) => {
    if (!z.coerce.number().int().positive().safeParse(params.assetId).success) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `notFound()` is the documented control-flow signal
      throw notFound();
    }
  },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      assetDetailQueryOptions(
        { id: Number(params.assetId), type: "experience" },
        context.apiClient,
      ),
    );
    void context.queryClient.prefetchQuery(
      projectDetailQueryOptions(Number(params.projectId), context.apiClient),
    );
  },
  component: ExperienceDetailRoute,
});

function ExperienceDetailRoute(): JSX.Element {
  const { assetId, projectId } = Route.useParams();
  return (
    <AssetDetailPage
      assetId={Number(assetId)}
      type="experience"
      projectId={Number(projectId)}
    />
  );
}
