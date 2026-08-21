import {
  projectDevicesQueryOptions,
  SandboxPage,
} from "@sico/shared/features/sandbox-devices/index.ts";
import { createFileRoute, notFound } from "@tanstack/react-router";
import type * as React from "react";
import { z } from "zod";

const paramsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});

// Full-page sandbox device list for a project. The loader prefetches the device
// list fire-and-forget so the feature's own loading state stays observable.
export const Route = createFileRoute("/_authed/project/$projectId/sandbox")({
  beforeLoad: ({ params }) => {
    if (!paramsSchema.safeParse(params).success) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `notFound()` is the documented control-flow signal
      throw notFound();
    }
  },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      projectDevicesQueryOptions(Number(params.projectId), context.apiClient),
    );
  },
  component: SandboxRoutePage,
});

function SandboxRoutePage(): React.JSX.Element {
  const { projectId } = Route.useParams();
  return <SandboxPage projectId={Number(projectId)} />;
}
