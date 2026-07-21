import {
  KnowledgeTags,
  knowledgeTagsQueryOptions,
  projectDetailQueryOptions,
} from "@sico/shared/features/projects/index.ts";
import { createFileRoute } from "@tanstack/react-router";
import type * as React from "react";

// Loader prefetches fire-and-forget so the feature's Suspense skeleton stays
// observable; the shell owns its own Suspense + ErrorBoundary.
export const Route = createFileRoute(
  "/_authed/project/$projectId/knowledge-tags",
)({
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      knowledgeTagsQueryOptions(Number(params.projectId), context.apiClient),
    );
    void context.queryClient.prefetchQuery(
      projectDetailQueryOptions(Number(params.projectId), context.apiClient),
    );
  },
  component: KnowledgeTagsPage,
});

function KnowledgeTagsPage(): React.JSX.Element {
  const { projectId } = Route.useParams();
  return <KnowledgeTags projectId={Number(projectId)} />;
}
