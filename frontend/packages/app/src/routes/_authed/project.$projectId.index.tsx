import {
  type AssetSearch,
  assetSearchSchema,
  assetsInfiniteQueryOptions,
  knowledgeTagsQueryOptions,
  projectDetailQueryOptions,
  ProjectWorkspace,
} from "@sico/shared/features/projects/index.ts";
import {
  createFileRoute,
  type SearchSchemaInput,
  stripSearchParams,
} from "@tanstack/react-router";
import type * as React from "react";

// The per-project workspace lives at the project root (`/project/$projectId`)
// as an index route — this is the ALL category (mixed list). The sibling
// category routes (`/knowledge`, `/deliverable`, `/experience`) each render the
// same workspace with their own category. `sort`/`q` ride in the search params
// (the category itself is now the route path, no longer `?tab=`).
//
// `stripSearchParams(DEFAULT_SEARCH)` drops any param equal to its default from
// the URL, so the clean `/project/$projectId` stays clean (no `?sort=desc&q=`);
// only a non-default sort/query is serialized.
const DEFAULT_SEARCH = assetSearchSchema.parse({});

export const Route = createFileRoute("/_authed/project/$projectId/")({
  validateSearch: (
    search: Record<string, unknown> & SearchSchemaInput,
  ): AssetSearch => assetSearchSchema.parse(search),
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  loader: ({ context, params }) => {
    const projectId = Number(params.projectId);
    // Kick off every query the workspace + its drawer read, in PARALLEL, so the
    // drawer's knowledge-tags (suspense) don't fire as a post-mount client
    // waterfall — they resolve alongside the project detail behind the single
    // ProjectWorkspaceSkeleton instead of popping in. The drawer's Sandbox +
    // Team sections read `project.sandboxes` / `project.projectMembers` inline
    // from the detail payload, so no separate devices/members prefetch here.
    void context.queryClient.prefetchQuery(
      projectDetailQueryOptions(projectId, context.apiClient),
    );
    void context.queryClient.prefetchInfiniteQuery(
      assetsInfiniteQueryOptions(projectId, "all", context.apiClient),
    );
    void context.queryClient.prefetchQuery(
      knowledgeTagsQueryOptions(projectId, context.apiClient),
    );
  },
  component: ProjectOverviewPage,
});

function ProjectOverviewPage(): React.JSX.Element {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectWorkspace
      projectId={Number(projectId)}
      category="all"
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: (prev) => ({ ...prev, ...next }) });
      }}
    />
  );
}
