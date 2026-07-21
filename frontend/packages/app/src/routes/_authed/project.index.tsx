import {
  Projects,
  projectsQueryOptions,
} from "@sico/shared/features/projects/index.ts";
import { createFileRoute } from "@tanstack/react-router";

// Loader is fire-and-forget so `<Projects>` mounts past Suspense and the
// in-feature skeleton + ErrorBoundary stay observable.
export const Route = createFileRoute("/_authed/project/")({
  loader: ({ context }) => {
    void context.queryClient.prefetchInfiniteQuery(
      projectsQueryOptions({}, context.apiClient),
    );
  },
  head: () => ({ meta: [{ title: "Projects · SICO" }] }),
  component: Projects,
});
