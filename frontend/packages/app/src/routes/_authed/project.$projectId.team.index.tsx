import { createFileRoute, redirect } from "@tanstack/react-router";

// Bare `/team` → the Operators tab. Team has no combined view; the operators
// tab is the default landing, mirroring how `/project/$id` defaults `all`.
export const Route = createFileRoute("/_authed/project/$projectId/team/")({
  beforeLoad: ({ params }) => {
    // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `redirect()` is the documented control-flow signal
    throw redirect({
      to: "/project/$projectId/team/operators",
      params: { projectId: params.projectId },
    });
  },
});
