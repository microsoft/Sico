import {
  agentInfosQueryOptions,
  Studio,
} from "@sico/shared/features/studio/index.ts";
import { createFileRoute } from "@tanstack/react-router";

// Loader is fire-and-forget so `<Studio>` mounts past Suspense and the
// in-feature skeleton + ErrorBoundary stay observable. Mirrors `/digital-worker`.
export const Route = createFileRoute("/_authed/studio/")({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      agentInfosQueryOptions(context.apiClient),
    );
  },
  head: () => ({ meta: [{ title: "Studio · SICO" }] }),
  component: Studio,
});
