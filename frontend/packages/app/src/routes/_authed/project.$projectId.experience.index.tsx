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

// The Experience category list (`/project/$projectId/experience`). Sibling of
// the experience detail route (`experience/$assetId`) under the `experience`
// Outlet, so the detail page is never wrapped by this list's chrome.
const DEFAULT_SEARCH = assetSearchSchema.parse({});

export const Route = createFileRoute("/_authed/project/$projectId/experience/")(
  {
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
        assetsInfiniteQueryOptions(projectId, "experience", context.apiClient),
      );
    },
    component: ExperienceCategoryPage,
  },
);

function ExperienceCategoryPage(): React.JSX.Element {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectWorkspace
      projectId={Number(projectId)}
      category="experience"
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: (prev) => ({ ...prev, ...next }) });
      }}
    />
  );
}
