import {
  AssetDetailPage,
  assetDetailQueryOptions,
  projectDetailQueryOptions,
} from "@sico/shared/features/projects/index.ts";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { type JSX } from "react";
import { z } from "zod";

// Loader prefetches fire-and-forget (no await) so the suspense fallback stays
// observable; `:projectId` is guarded by the layout parent, `:assetId` here.
export const Route = createFileRoute(
  "/_authed/project/$projectId/deliverable/$assetId",
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
        { id: Number(params.assetId), type: "deliverable" },
        context.apiClient,
      ),
    );
    void context.queryClient.prefetchQuery(
      projectDetailQueryOptions(Number(params.projectId), context.apiClient),
    );
  },
  component: DeliverableDetailRoute,
});

function DeliverableDetailRoute(): JSX.Element {
  const { assetId, projectId } = Route.useParams();
  return (
    <AssetDetailPage
      assetId={Number(assetId)}
      type="deliverable"
      projectId={Number(projectId)}
    />
  );
}
