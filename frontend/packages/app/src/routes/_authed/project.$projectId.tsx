import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import type { JSX } from "react";
import { z } from "zod";

const paramsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});

// Thin layout route — guards `:projectId` once for all children, renders a bare
// <Outlet/>. Validation is in `beforeLoad`, not `parseParams`, because
// `parseParams` errors route to `errorComponent`, not the 404 boundary.
export const Route = createFileRoute("/_authed/project/$projectId")({
  beforeLoad: ({ params }) => {
    if (!paramsSchema.safeParse(params).success) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `notFound()` is the documented control-flow signal
      throw notFound();
    }
  },
  component: ProjectLayout,
});

function ProjectLayout(): JSX.Element {
  return <Outlet />;
}
