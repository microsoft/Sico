import {
  agentsQueryOptions,
  DigitalWorkers,
} from "@sico/shared/features/digital-worker/index.ts";
import { createFileRoute } from "@tanstack/react-router";

// Loader is fire-and-forget so `<DigitalWorkers>` mounts past Suspense
// and the in-feature skeleton + ErrorBoundary stay observable. Mirrors
// the pattern used by `/project`.
export const Route = createFileRoute("/_authed/digital-worker/")({
  loader: ({ context }) => {
    void context.queryClient.prefetchInfiniteQuery(
      agentsQueryOptions({}, context.apiClient),
    );
  },
  head: () => ({ meta: [{ title: "Digital Workers · SICO" }] }),
  component: DigitalWorkers,
});
