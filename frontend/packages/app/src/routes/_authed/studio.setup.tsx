import { rolesQueryOptions } from "@sico/shared/features/skill/index.ts";
import { CreateSetupPage } from "@sico/shared/features/studio/index.ts";
import { createFileRoute } from "@tanstack/react-router";

// Create-mode setup (no agentId). The page body lives in @sico/shared
// (CreateSetupPage); this route owns only the roles prefetch and metadata.
export const Route = createFileRoute("/_authed/studio/setup")({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      rolesQueryOptions(context.apiClient),
    );
  },
  head: () => ({ meta: [{ title: "Create Digital Worker · SICO" }] }),
  component: CreateSetupPage,
});
