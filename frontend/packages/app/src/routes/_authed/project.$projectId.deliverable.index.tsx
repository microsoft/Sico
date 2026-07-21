import {
  type AssetSearch,
  assetSearchSchema,
  assetsInfiniteQueryOptions,
  projectDetailQueryOptions,
  ProjectWorkspace,
} from "@sico/shared/features/projects/index.ts";
import {
  createFileRoute,
  type SearchSchemaInput,
  stripSearchParams,
} from "@tanstack/react-router";
import type * as React from "react";

// The Deliverable category list (`/project/$projectId/deliverable`). Sibling of
// the deliverable detail route (`deliverable/$assetId`) under the `deliverable`
// Outlet, so the detail page is never wrapped by this list's chrome.
const DEFAULT_SEARCH = assetSearchSchema.parse({});

export const Route = createFileRoute(
  "/_authed/project/$projectId/deliverable/",
)({
  validateSearch: (
    search: Record<string, unknown> & SearchSchemaInput,
  ): AssetSearch => assetSearchSchema.parse(search),
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  loader: ({ context, params }) => {
    const projectId = Number(params.projectId);
    void context.queryClient.prefetchQuery(
      projectDetailQueryOptions(projectId, context.apiClient),
    );
    // Prefetch the first page of this category's list in parallel, so the
    // suspense rows resolve from cache instead of fetch-on-render.
    void context.queryClient.prefetchInfiniteQuery(
      assetsInfiniteQueryOptions(projectId, "deliverable", context.apiClient),
    );
  },
  component: DeliverableCategoryPage,
});

function DeliverableCategoryPage(): React.JSX.Element {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectWorkspace
      projectId={Number(projectId)}
      category="deliverable"
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: (prev) => ({ ...prev, ...next }) });
      }}
    />
  );
}
