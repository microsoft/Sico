import { userAtom } from "@sico/shared";
import {
  agentsQueryOptions,
  DigitalWorkers,
} from "@sico/shared/features/digital-worker/index.ts";
import { createFileRoute } from "@tanstack/react-router";

import { store } from "../../store";

// Loader is fire-and-forget so `<DigitalWorkers>` mounts past Suspense
// and the in-feature skeleton + ErrorBoundary stay observable. Mirrors
// the pattern used by `/project`. Prefetch keys on the current user's
// `operatorUsername` so it hits the SAME cache entry the component reads.
export const Route = createFileRoute("/_authed/digital-worker/")({
  loader: ({ context }) => {
    const operatorUsername = store.get(userAtom)?.email;
    void context.queryClient.prefetchInfiniteQuery(
      agentsQueryOptions({ operatorUsername }, context.apiClient),
    );
  },
  head: () => ({ meta: [{ title: "Digital Workers · SICO" }] }),
  component: DigitalWorkers,
});
